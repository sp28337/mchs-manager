"""LM010 — роутер `/leave`.

Отображение доменных исключений на каталог API_Conventions разд. 3:

* `404` — отпуск не найден.
* `409` — пересечение с существующим отпуском (инвариант 9.1.1) и
  конфликт с утверждённой сменой (9.1.4): и то и другое — конфликт
  СОСТОЯНИЯ, запрос станет исполнимым, как только состояние изменят.
* `422` — повторная выдача одноразового отпуска (9.1.2), отзыв из
  недействующего отпуска или вне его периода, нехватка суток ДДО.
* `423` — попытка изменить неизменяемое поле приказа.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Path
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.application.problem import problem_exception
from src.building_blocks.infrastructure.db import get_session
from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.leave_management.api.schemas import (
    CreateLeaveGrantRequest,
    LeaveGrantResponse,
    RecallEventResponse,
    RecallFromLeaveRequest,
)
from src.modules.leave_management.application.commands.create_leave_grant.command import (
    CreateLeaveGrantCommand,
)
from src.modules.leave_management.application.commands.create_leave_grant.handler import (
    CreateLeaveGrantHandler,
)
from src.modules.leave_management.application.commands.recall_from_leave.command import (
    RecallFromLeaveCommand,
)
from src.modules.leave_management.application.commands.recall_from_leave.handler import (
    RecallFromLeaveHandler,
)
from src.modules.leave_management.application.queries.get_employee_leave_grants.handler import (
    GetEmployeeLeaveGrantsHandler,
)
from src.modules.leave_management.application.queries.get_leave_grant.handler import (
    GetLeaveGrantHandler,
)
from src.modules.leave_management.application.services.entitlement_calculator import (
    EntitlementCalculator,
)
from src.modules.leave_management.application.services.leave_eligibility import (
    LeaveEligibilityService,
)
from src.modules.leave_management.application.services.schedule_conflict_checker import (
    ScheduleConflictChecker,
)
from src.modules.leave_management.domain.errors import (
    LeaveGrantNotFoundError,
    LeaveImmutableError,
    LeaveNotRecallableError,
    LeavePeriodOverlapError,
    OncePerServiceLeaveError,
    RecallOutsideLeaveError,
    ScheduleConflictError,
)
from src.modules.leave_management.domain.leave_grant import LeaveGrant, RecallEvent
from src.modules.leave_management.infrastructure.adapters import (
    LegalRulesLeaveEntitlement,
    PersonnelSeniority,
    SchedulingApprovedShifts,
)
from src.modules.leave_management.infrastructure.anticorruption.rest_balance_client import (
    RestBalanceClient,
)
from src.modules.leave_management.infrastructure.orm_mapping import outbox_message_table
from src.modules.leave_management.infrastructure.repositories import LeaveGrantRepository
from src.modules.legal_rules.contracts.get_effective_rule_version import (
    RuleVersionNotApplicable,
)
from src.modules.rest_balance.contracts.consume_rest_days import NotEnoughRestDays

router = APIRouter()

SessionDep = Annotated[AsyncSession, Depends(get_session)]
IdempotencyKeyDep = Annotated[UUID, Header(alias="Idempotency-Key")]

_problem = problem_exception


def _to_response(grant: LeaveGrant) -> LeaveGrantResponse:
    return LeaveGrantResponse(
        id=grant.id,
        employee_id=grant.employee_id,
        leave_type=grant.leave_type,
        period_start=grant.period.start,
        period_end=grant.period.end,
        status=grant.status,
        entitlement_basis_rule_version_id=grant.entitlement.rule_version_id,
        entitled_days=grant.entitlement.entitled_days,
        seniority_years=grant.entitlement.seniority_years,
        attached_rest_days=grant.attached_rest_days,
        used_days=grant.used_days,
        unused_days=grant.unused_days,
    )


def _to_recall_response(grant: LeaveGrant, event: RecallEvent) -> RecallEventResponse:
    return RecallEventResponse(
        id=event.id,
        leave_grant_id=event.leave_grant_id,
        recall_date=event.recall_date,
        effective_from=event.effective_from,
        used_days=grant.used_days,
        unused_days=grant.unused_days,
    )


def _handler(session: AsyncSession) -> CreateLeaveGrantHandler:
    repo = LeaveGrantRepository(session)
    return CreateLeaveGrantHandler(
        session,
        repo,
        LeaveEligibilityService(repo, ScheduleConflictChecker(SchedulingApprovedShifts(session))),
        EntitlementCalculator(
            PersonnelSeniority(session), LegalRulesLeaveEntitlement(session)
        ),
        OutboxWriter(session, outbox_message_table),
        RestBalanceClient(session),
    )


@router.post("/grants", response_model=LeaveGrantResponse, status_code=201)
async def create_leave_grant(
    request: CreateLeaveGrantRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> LeaveGrantResponse:
    try:
        grant = await _handler(session).handle(
            CreateLeaveGrantCommand(
                employee_id=request.employee_id,
                leave_type=request.leave_type.value,
                period_start=request.period_start,
                period_end=request.period_end,
                attached_rest_days=request.attached_rest_days,
            )
        )
    except LeavePeriodOverlapError as exc:
        raise _problem(
            409, "conflict", "Пересечение с существующим отпуском", str(exc)
        ) from exc
    except ScheduleConflictError as exc:
        raise _problem(
            409, "conflict", "Конфликт с утверждённой сменой", str(exc)
        ) from exc
    except OncePerServiceLeaveError as exc:
        raise _problem(
            422,
            "domain-invariant-violation",
            "Отпуск этого вида предоставляется один раз за службу",
            str(exc),
        ) from exc
    except NotEnoughRestDays as exc:
        raise _problem(
            422,
            "insufficient-balance",
            "Недостаточно суток отдыха для присоединения к отпуску",
            str(exc),
            balanceDays=str(exc.balance),
            requestedDays=str(exc.requested),
        ) from exc
    except RuleVersionNotApplicable as exc:
        raise _problem(
            422,
            "rule-version-not-found",
            "Не найдено действующее правило продолжительности отпуска",
            str(exc),
        ) from exc
    except ValueError as exc:
        raise _problem(422, "validation-failed", "Период отпуска некорректен", str(exc)) from exc
    except IntegrityError as exc:
        # Последнее слово БД: два приказа, оформленных одновременно,
        # увидели бы одинаковое «свободно». Сообщение ограничения
        # кадровику не поможет, поэтому здесь — тот же смысл своими
        # словами.
        raise _problem(
            409,
            "conflict",
            "Отпуск не может быть предоставлен",
            "период пересекается с другим отпуском сотрудника либо отпуск этого "
            "вида уже предоставлялся (проверка на уровне БД)",
        ) from exc

    return _to_response(grant)


@router.get("/employees/{employee_id}/grants", response_model=list[LeaveGrantResponse])
async def list_employee_grants(
    employee_id: Annotated[UUID, Path()], session: SessionDep
) -> list[LeaveGrantResponse]:
    handler = GetEmployeeLeaveGrantsHandler(LeaveGrantRepository(session))
    return [_to_response(g) for g in await handler.handle(employee_id)]


@router.get("/grants/{grant_id}", response_model=LeaveGrantResponse)
async def get_leave_grant(
    grant_id: Annotated[UUID, Path()], session: SessionDep
) -> LeaveGrantResponse:
    handler = GetLeaveGrantHandler(LeaveGrantRepository(session))
    try:
        grant = await handler.handle(grant_id)
    except LeaveGrantNotFoundError as exc:
        raise _problem(404, "not-found", "Отпуск не найден", str(exc)) from exc
    return _to_response(grant)


@router.post("/grants/{grant_id}/recall", response_model=RecallEventResponse, status_code=201)
async def recall_from_leave(
    grant_id: Annotated[UUID, Path()],
    request: RecallFromLeaveRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> RecallEventResponse:
    repo = LeaveGrantRepository(session)
    handler = RecallFromLeaveHandler(
        session, repo, OutboxWriter(session, outbox_message_table)
    )
    try:
        event = await handler.handle(
            RecallFromLeaveCommand(
                grant_id=grant_id,
                recall_date=request.recall_date,
                effective_from=request.effective_from,
            )
        )
    except LeaveGrantNotFoundError as exc:
        raise _problem(404, "not-found", "Отпуск не найден", str(exc)) from exc
    except LeaveNotRecallableError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Отпуск нельзя отозвать", str(exc)
        ) from exc
    except RecallOutsideLeaveError as exc:
        raise _problem(
            422,
            "domain-invariant-violation",
            "Дата прерывания лежит вне отпуска",
            str(exc),
        ) from exc
    except LeaveImmutableError as exc:
        raise _problem(
            423, "immutable-resource", "Приказ об отпуске неизменяем", str(exc)
        ) from exc
    except ValueError as exc:
        raise _problem(422, "validation-failed", "Даты отзыва некорректны", str(exc)) from exc

    grant = await repo.get(grant_id)
    assert grant is not None
    return _to_recall_response(grant, event)
