"""SD011 — роутер `scheduling`.

Те же правила Presentation-слоя, что и в остальных модулях. Отображение
доменных исключений на каталог API_Conventions разд. 3:

* `409` — пересечение смен. Разд. 3 называет этот код прямым отражением
  `EXCLUDE`-ограничений, и `openapi.yaml` описывает для этой операции
  именно «Пересечение смен сотрудника (EXCLUDE-инвариант)».
* `422` — нарушения инвариантов домена: сотрудник не активен, мало
  межсменного отдыха, смена вне периода графика, нет применимой версии
  правила отдыха.
* `423` — попытка изменить утверждённый график.

`IntegrityError` от `excl_planned_shift_no_overlap` перехватывается
отдельно: агрегат ловит пересечение только внутри своего графика, а
пересечение через границу двух графиков ловит БД — и без этого перехвата
пользователь получил бы 500 вместо 409 ровно в том случае, ради которого
ограничение сделано глобальным.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Path, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.application.problem import problem_exception
from src.building_blocks.infrastructure.db import get_session
from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.legal_rules.contracts.get_effective_rule_version import RuleVersionNotApplicable
from src.modules.scheduling.api.schemas import (
    ApproveScheduleRequest,
    CreateDutyScheduleRequest,
    CreatePlannedShiftRequest,
    DutyScheduleResponse,
    PlannedShiftResponse,
    ReviseScheduleRequest,
)
from src.modules.scheduling.application.commands.add_planned_shift.command import (
    AddPlannedShiftCommand,
)
from src.modules.scheduling.application.commands.add_planned_shift.handler import (
    AddPlannedShiftHandler,
)
from src.modules.scheduling.application.commands.approve_schedule.command import (
    ApproveScheduleCommand,
)
from src.modules.scheduling.application.commands.approve_schedule.handler import (
    ApproveScheduleHandler,
)
from src.modules.scheduling.application.commands.draft_schedule.command import DraftScheduleCommand
from src.modules.scheduling.application.commands.draft_schedule.handler import DraftScheduleHandler
from src.modules.scheduling.application.commands.revise_schedule.command import (
    ReviseScheduleCommand,
)
from src.modules.scheduling.application.commands.revise_schedule.handler import (
    ReviseScheduleHandler,
)
from src.modules.scheduling.application.queries.get_schedule_for_unit.handler import (
    GetScheduleForUnitHandler,
)
from src.modules.scheduling.application.queries.get_schedule_for_unit.query import (
    GetScheduleForUnitQuery,
)
from src.modules.scheduling.domain.duty_schedule import DutySchedule, PlannedShift
from src.modules.scheduling.domain.errors import (
    EmployeeNotAvailableForShiftError,
    MinimumRestPeriodViolationError,
    OverlappingShiftError,
    ScheduleApprovedError,
    ScheduleNotFoundError,
    SchedulePeriodAlreadyExistsError,
    ShiftOutsideSchedulePeriodError,
)
from src.modules.scheduling.infrastructure.adapters import (
    LegalRulesMinimumRestPeriod,
    PersonnelEmployeeAvailability,
)
from src.modules.scheduling.infrastructure.orm_mapping import outbox_message_table
from src.modules.scheduling.infrastructure.repositories import DutyScheduleRepository

router = APIRouter()

SessionDep = Annotated[AsyncSession, Depends(get_session)]
IdempotencyKeyDep = Annotated[UUID, Header(alias="Idempotency-Key")]

_problem = problem_exception

_OVERLAP_CONSTRAINT = "excl_planned_shift_no_overlap"


def _to_shift_response(shift: PlannedShift) -> PlannedShiftResponse:
    return PlannedShiftResponse(
        id=shift.id,
        duty_schedule_id=shift.duty_schedule_id,
        employee_id=shift.employee_id,
        start_time=shift.time_range.start,
        end_time=shift.time_range.end,
        duty_type=shift.duty_type,
    )


def _to_response(schedule: DutySchedule) -> DutyScheduleResponse:
    return DutyScheduleResponse(
        id=schedule.id,
        unit_id=schedule.unit_id,
        period_type=schedule.period.period_type,
        period_start=schedule.period.start,
        period_end=schedule.period.end,
        status=schedule.status,
        approval_order_ref=schedule.approval_order_ref,
        revision_no=schedule.revision_no,
        previous_schedule_id=schedule.previous_schedule_id,
        revision_reason=schedule.revision_reason,
        shifts=[_to_shift_response(s) for s in schedule.shifts if not s.superseded],
    )


@router.post("/duty-schedules", response_model=DutyScheduleResponse, status_code=201)
async def create_duty_schedule(
    request: CreateDutyScheduleRequest, session: SessionDep, idempotency_key: IdempotencyKeyDep
) -> DutyScheduleResponse:
    handler = DraftScheduleHandler(session, DutyScheduleRepository(session))
    try:
        schedule = await handler.handle(
            DraftScheduleCommand(
                unit_id=request.unit_id,
                period_type=request.period_type,
                period_start=request.period_start,
                period_end=request.period_end,
            )
        )
    except SchedulePeriodAlreadyExistsError as exc:
        raise _problem(
            409, "overlapping-interval", "График на этот период уже существует", str(exc)
        ) from exc
    except ValueError as exc:
        raise _problem(400, "validation-failed", "Некорректный период", str(exc)) from exc

    return _to_response(schedule)


@router.get("/duty-schedules/{schedule_id}", response_model=DutyScheduleResponse)
async def get_duty_schedule(
    schedule_id: Annotated[UUID, Path()], session: SessionDep
) -> DutyScheduleResponse:
    schedule = await DutyScheduleRepository(session).get(schedule_id)
    if schedule is None:
        raise _problem(404, "not-found", "График не найден", f"DutySchedule {schedule_id}")
    return _to_response(schedule)


@router.post(
    "/duty-schedules/{schedule_id}/shifts",
    response_model=PlannedShiftResponse,
    status_code=201,
)
async def add_planned_shift(
    schedule_id: Annotated[UUID, Path()],
    request: CreatePlannedShiftRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> PlannedShiftResponse:
    handler = AddPlannedShiftHandler(
        session,
        DutyScheduleRepository(session),
        PersonnelEmployeeAvailability(session),
        LegalRulesMinimumRestPeriod(session),
    )
    try:
        shift = await handler.handle(
            AddPlannedShiftCommand(
                schedule_id=schedule_id,
                employee_id=request.employee_id,
                start_time=request.start_time,
                end_time=request.end_time,
                duty_type=request.duty_type,
                # `scope` правила минимального отдыха. Пока пустой:
                # различать нормы отдыха по правовой базе/режиму имеет
                # смысл только когда такие RuleVersion появятся, а
                # выдумывать измерения scope заранее значит зафиксировать
                # их до того, как ведомственный акт их назовёт.
                rule_scope={},
            )
        )
    except ScheduleNotFoundError as exc:
        raise _problem(404, "not-found", "График не найден", str(exc)) from exc
    except OverlappingShiftError as exc:
        raise _problem(
            409, "overlapping-interval", "Смены сотрудника пересекаются", str(exc)
        ) from exc
    except ScheduleApprovedError as exc:
        raise _problem(423, "immutable-resource", "График утверждён", str(exc)) from exc
    except EmployeeNotAvailableForShiftError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Сотрудник недоступен для назначения", str(exc)
        ) from exc
    except MinimumRestPeriodViolationError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Нарушен минимальный межсменный отдых", str(exc)
        ) from exc
    except ShiftOutsideSchedulePeriodError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Смена вне периода графика", str(exc)
        ) from exc
    except RuleVersionNotApplicable as exc:
        raise _problem(
            422,
            "rule-version-not-found",
            "Не найдена действующая норма межсменного отдыха",
            str(exc),
        ) from exc
    except ValueError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Некорректный интервал", str(exc)
        ) from exc
    except IntegrityError as exc:
        # Пересечение через границу двух графиков: агрегат его увидеть не
        # может, ловит БД. Без этой ветки был бы 500 вместо 409.
        if _OVERLAP_CONSTRAINT in str(exc):
            await session.rollback()
            raise _problem(
                409,
                "overlapping-interval",
                "Смены сотрудника пересекаются",
                "смена пересекается с уже назначенной сменой этого сотрудника "
                "(возможно, в графике соседнего периода)",
            ) from exc
        raise

    return _to_shift_response(shift)


@router.post("/duty-schedules/{schedule_id}/approve", response_model=DutyScheduleResponse)
async def approve_duty_schedule(
    schedule_id: Annotated[UUID, Path()],
    request: ApproveScheduleRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> DutyScheduleResponse:
    handler = ApproveScheduleHandler(
        session, DutyScheduleRepository(session), OutboxWriter(session, outbox_message_table)
    )
    try:
        schedule = await handler.handle(
            ApproveScheduleCommand(
                schedule_id=schedule_id, approval_order_ref=request.approval_order_ref
            )
        )
    except ScheduleNotFoundError as exc:
        raise _problem(404, "not-found", "График не найден", str(exc)) from exc
    except ScheduleApprovedError as exc:
        raise _problem(
            422, "domain-invariant-violation", "График нельзя утвердить", str(exc)
        ) from exc

    return _to_response(schedule)


@router.post(
    "/duty-schedules/{schedule_id}/revise", response_model=DutyScheduleResponse, status_code=201
)
async def revise_duty_schedule(
    schedule_id: Annotated[UUID, Path()],
    request: ReviseScheduleRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> DutyScheduleResponse:
    handler = ReviseScheduleHandler(
        session, DutyScheduleRepository(session), OutboxWriter(session, outbox_message_table)
    )
    try:
        successor = await handler.handle(
            ReviseScheduleCommand(schedule_id=schedule_id, reason=request.reason)
        )
    except ScheduleNotFoundError as exc:
        raise _problem(404, "not-found", "График не найден", str(exc)) from exc
    except ScheduleApprovedError as exc:
        raise _problem(
            422, "domain-invariant-violation", "График нельзя пересмотреть", str(exc)
        ) from exc

    return _to_response(successor)


@router.get("/units/{unit_id}/duty-schedules", response_model=list[DutyScheduleResponse])
async def list_unit_duty_schedules(
    unit_id: Annotated[UUID, Path()],
    session: SessionDep,
    period_start: Annotated[date, Query(alias="periodStart")],
    period_end: Annotated[date, Query(alias="periodEnd")],
) -> list[DutyScheduleResponse]:
    handler = GetScheduleForUnitHandler(DutyScheduleRepository(session))
    schedules = await handler.handle(
        GetScheduleForUnitQuery(
            unit_id=unit_id, period_start=period_start, period_end=period_end
        )
    )
    return [_to_response(s) for s in schedules]
