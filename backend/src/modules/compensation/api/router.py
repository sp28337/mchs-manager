"""CO016 — роутер `compensation`.

Отображение доменных исключений на каталог API_Conventions разд. 3:

* `409` — дело на этот период уже существует.
* `422` — табель не утверждён (инвариант 7.1.1), компенсация сверх факта
  (7.1.2), выбор формы там, где правило его не допускает (7.1.3), пустое
  дело, отсутствие действующего правила компенсации.
* `423` — попытка изменить финализированное дело (7.1.4).
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Path, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.application.problem import problem_exception
from src.building_blocks.infrastructure.db import get_session
from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.compensation.api.schemas import (
    CompensationCaseResponse,
    CompensationLineResponse,
    CreateCompensationCaseRequest,
    RecordEmployeeElectionRequest,
    RegionalCompensationForecastResponse,
)
from src.modules.compensation.application.commands.create_compensation_case.command import (
    CreateCompensationCaseCommand,
)
from src.modules.compensation.application.commands.create_compensation_case.handler import (
    CreateCompensationCaseHandler,
)
from src.modules.compensation.application.commands.finalize_compensation_case.command import (
    FinalizeCompensationCaseCommand,
)
from src.modules.compensation.application.commands.finalize_compensation_case.handler import (
    FinalizeCompensationCaseHandler,
)
from src.modules.compensation.application.commands.record_employee_election.command import (
    RecordEmployeeElectionCommand,
)
from src.modules.compensation.application.commands.record_employee_election.handler import (
    RecordEmployeeElectionHandler,
)
from src.modules.compensation.application.services.compensation_allocation import (
    CompensationAllocationService,
)
from src.modules.compensation.domain.compensation_case import (
    CompensationCase,
    CompensationLine,
)
from src.modules.compensation.domain.errors import (
    CaseAlreadyExistsError,
    CaseFinalizedError,
    CaseNotFoundError,
    CompensationExceedsFactError,
    ElectionNotApplicableError,
    EmptyCompensationCaseError,
    TimesheetNotApprovedError,
)
from src.modules.compensation.infrastructure.adapters import (
    LegalRulesCompensationRule,
    PersonnelEmployeeUnit,
    TimeAccountingApprovedPeriod,
)
from src.modules.compensation.infrastructure.orm_mapping import outbox_message_table
from src.modules.compensation.infrastructure.read_orm_mapping import regional_forecast_table
from src.modules.compensation.infrastructure.repositories import CompensationCaseRepository
from src.modules.legal_rules.contracts.get_effective_rule_version import (
    RuleVersionNotApplicable,
)

router = APIRouter()

SessionDep = Annotated[AsyncSession, Depends(get_session)]
IdempotencyKeyDep = Annotated[UUID, Header(alias="Idempotency-Key")]

_problem = problem_exception


def _to_line_response(line: CompensationLine) -> CompensationLineResponse:
    return CompensationLineResponse(
        id=line.id,
        hour_category=line.hour_category,
        hours_amount=line.hours_amount,
        compensation_form=line.compensation_form,
        legal_basis_rule_version_id=line.legal_basis_rule_version_id,
        employee_election_at=line.employee_election_at,
        election_allowed=line.election_allowed,
    )


def _to_response(case: CompensationCase) -> CompensationCaseResponse:
    return CompensationCaseResponse(
        id=case.id,
        employee_id=case.employee_id,
        timesheet_id=case.timesheet_id,
        period_start=case.period.start,
        period_end=case.period.end,
        status=case.status,
        unit_id=case.unit_id,
        corrects_case_id=case.corrects_case_id,
        finalized_at=case.finalized_at,
        lines=[_to_line_response(line) for line in case.lines],
    )


def _allocation(session: AsyncSession) -> CompensationAllocationService:
    rules = LegalRulesCompensationRule(session)
    return CompensationAllocationService(
        lambda as_of, scope: rules.rule_for(as_of=as_of, scope=scope)
    )


@router.post("/cases", response_model=CompensationCaseResponse, status_code=201)
async def create_compensation_case(
    request: CreateCompensationCaseRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> CompensationCaseResponse:
    handler = CreateCompensationCaseHandler(
        session,
        CompensationCaseRepository(session),
        TimeAccountingApprovedPeriod(session),
        _allocation(session),
        PersonnelEmployeeUnit(session),
    )
    try:
        case = await handler.handle(
            CreateCompensationCaseCommand(
                employee_id=request.employee_id,
                period_start=request.period_start,
                period_end=request.period_end,
            )
        )
    except TimesheetNotApprovedError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Табель периода не утверждён", str(exc)
        ) from exc
    except CaseAlreadyExistsError as exc:
        raise _problem(409, "conflict", "Дело за этот период уже заведено", str(exc)) from exc
    except CompensationExceedsFactError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Компенсация превышает факт", str(exc)
        ) from exc
    except RuleVersionNotApplicable as exc:
        raise _problem(
            422,
            "rule-version-not-found",
            "Не найдено действующее правило компенсации",
            str(exc),
        ) from exc

    return _to_response(case)


@router.get("/cases/{case_id}", response_model=CompensationCaseResponse)
async def get_compensation_case(
    case_id: Annotated[UUID, Path()], session: SessionDep
) -> CompensationCaseResponse:
    case = await CompensationCaseRepository(session).get(case_id)
    if case is None:
        raise _problem(404, "not-found", "Дело не найдено", f"CompensationCase {case_id}")
    return _to_response(case)


@router.post("/cases/{case_id}/elections", response_model=CompensationCaseResponse)
async def record_employee_election(
    case_id: Annotated[UUID, Path()],
    request: RecordEmployeeElectionRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> CompensationCaseResponse:
    repo = CompensationCaseRepository(session)
    handler = RecordEmployeeElectionHandler(session, repo)
    try:
        await handler.handle(
            RecordEmployeeElectionCommand(
                case_id=case_id,
                hour_category=request.hour_category,
                form=request.compensation_form,
                # TODO(auth): дата подачи рапорта — момент обращения
                # сотрудника; когда появится аутентификация, сюда придёт
                # время, зафиксированное вместе с личностью заявителя.
                elected_at=datetime.now(UTC),
            )
        )
    except CaseNotFoundError as exc:
        raise _problem(404, "not-found", "Дело не найдено", str(exc)) from exc
    except ElectionNotApplicableError as exc:
        raise _problem(
            422,
            "domain-invariant-violation",
            "Выбор формы компенсации недоступен",
            str(exc),
        ) from exc
    except CaseFinalizedError as exc:
        raise _problem(423, "immutable-resource", "Дело финализировано", str(exc)) from exc

    case = await repo.get(case_id)
    assert case is not None
    return _to_response(case)


@router.post("/cases/{case_id}/finalize", response_model=CompensationCaseResponse)
async def finalize_compensation_case(
    case_id: Annotated[UUID, Path()],
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> CompensationCaseResponse:
    handler = FinalizeCompensationCaseHandler(
        session,
        CompensationCaseRepository(session),
        OutboxWriter(session, outbox_message_table),
    )
    try:
        case = await handler.handle(FinalizeCompensationCaseCommand(case_id=case_id))
    except CaseNotFoundError as exc:
        raise _problem(404, "not-found", "Дело не найдено", str(exc)) from exc
    except EmptyCompensationCaseError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Дело не содержит начислений", str(exc)
        ) from exc
    except CaseFinalizedError as exc:
        raise _problem(423, "immutable-resource", "Дело уже финализировано", str(exc)) from exc

    return _to_response(case)


@router.get(
    "/employees/{employee_id}/history", response_model=list[CompensationCaseResponse]
)
async def get_compensation_history(
    employee_id: Annotated[UUID, Path()],
    session: SessionDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=100)] = 20,
) -> list[CompensationCaseResponse]:
    """CO012. Читает write-модель напрямую: `Compensation` — не
    CQRS-модуль, дел у сотрудника единицы в год, и заводить под них
    проекцию значило бы платить сложностью за задачу, которой нет."""
    cases = await CompensationCaseRepository(session).list_for_employee(
        employee_id=employee_id, page=page, page_size=page_size
    )
    return [_to_response(case) for case in cases]


@router.get(
    "/regions/{region_unit_id}/forecast",
    response_model=RegionalCompensationForecastResponse,
)
async def get_regional_forecast(
    region_unit_id: Annotated[UUID, Path()],
    session: SessionDep,
    period_start: Annotated[date, Query(alias="periodStart")],
    period_end: Annotated[date, Query(alias="periodEnd")],
) -> RegionalCompensationForecastResponse:
    """CO015. Читает проекцию, построенную ночной задачей (CO014).

    Отсутствие строки — это 404, а не нули: «за регион ничего не
    начислено» и «прогноз ещё не строился» — разные ответы, и подменять
    второй первым значит показать финансисту ноль там, где данных просто
    нет.
    """
    row = (
        await session.execute(
            select(regional_forecast_table).where(
                regional_forecast_table.c.region_unit_id == region_unit_id,
                regional_forecast_table.c.period_start == period_start,
                regional_forecast_table.c.period_end == period_end,
            )
        )
    ).one_or_none()

    if row is None:
        raise _problem(
            404,
            "not-found",
            "Прогноз не найден",
            f"за период [{period_start}, {period_end}) по подразделению {region_unit_id} "
            f"проекция прогноза не построена: либо финализированных дел нет, либо "
            f"ночная задача ещё не отработала",
        )

    return RegionalCompensationForecastResponse(**dict(row._mapping))
