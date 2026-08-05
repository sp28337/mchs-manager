"""TA032 — роутер командной стороны `time_accounting`.

Отображение доменных исключений на каталог API_Conventions разд. 3 в
точности по `openapi.yaml`:

* `409` — пересечение с уже зарегистрированным фактом табеля; повторное
  открытие табеля на ту же пару «сотрудник + период»; дубликат номера
  приказа.
* `422` — нарушения инвариантов домена: привлечение сверх нормы без
  приказа, командировка без места, суточный предел 24 ч, событие вне
  периода табеля, переоткрытие без причины.
* `423` — попытка изменить утверждённый табель (`ImmutableResource`).

`IntegrityError` перехватывается отдельно по каждому из двух EXCLUDE:
агрегат видит пересечение только внутри своего табеля, а пересечение
фактических смен через границу ДВУХ табелей ловит
`excl_actual_shift_employee_no_overlap`. Без этой ветки пользователь
получил бы 500 вместо 409/422 ровно в том случае, ради которого
ограничение сделано глобальным.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, Path, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.application.problem import problem_exception
from src.building_blocks.infrastructure.db import get_session
from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.legal_rules.contracts.get_effective_conflict_policy import (
    ConflictPolicyNotApplicable,
)
from src.modules.legal_rules.contracts.get_effective_rule_version import RuleVersionNotApplicable
from src.modules.personnel.contracts.list_unit_employees import list_employee_ids_of_unit
from src.modules.service_calendar.contracts.get_calendar_days import CalendarPeriodUnavailable
from src.modules.time_accounting.api.schemas import (
    CorrectionEntryResponse,
    CreateCorrectionEntryRequest,
    CreateOvertimeOrderRequest,
    CreateServiceTimeEventRequest,
    CreateTimesheetRequest,
    HoursBreakdownResponse,
    OvertimeOrderResponse,
    ReopenTimesheetRequest,
    ServiceTimeEventResponse,
    TimesheetResponse,
    UnitTimesheetDashboardResponse,
)
from src.modules.time_accounting.application.commands.approve_timesheet.command import (
    ApproveTimesheetCommand,
)
from src.modules.time_accounting.application.commands.approve_timesheet.handler import (
    ApproveTimesheetHandler,
)
from src.modules.time_accounting.application.commands.create_correction_entry.command import (
    CreateCorrectionEntryCommand,
)
from src.modules.time_accounting.application.commands.create_correction_entry.handler import (
    CreateCorrectionEntryHandler,
)
from src.modules.time_accounting.application.commands.create_overtime_order.command import (
    CreateOvertimeOrderCommand,
)
from src.modules.time_accounting.application.commands.create_overtime_order.handler import (
    CreateOvertimeOrderHandler,
)
from src.modules.time_accounting.application.commands.open_timesheet.command import (
    OpenTimesheetCommand,
)
from src.modules.time_accounting.application.commands.open_timesheet.handler import (
    OpenTimesheetHandler,
)
from src.modules.time_accounting.application.commands.register_service_time_event.command import (
    RegisterServiceTimeEventCommand,
)
from src.modules.time_accounting.application.commands.register_service_time_event.handler import (
    RegisterServiceTimeEventHandler,
)
from src.modules.time_accounting.application.commands.reopen_timesheet.command import (
    ReopenTimesheetCommand,
)
from src.modules.time_accounting.application.commands.reopen_timesheet.handler import (
    ReopenTimesheetHandler,
)
from src.modules.time_accounting.application.services.conflict_resolver import (
    UnresolvableCategoryError,
)
from src.modules.time_accounting.application.services.daily_service_time_limit import (
    DailyServiceTimeLimitService,
)
from src.modules.time_accounting.application.services.hours_breakdown_pipeline import (
    HoursBreakdownPipeline,
)
from src.modules.time_accounting.application.services.hours_classifier import CalendarGapError
from src.modules.time_accounting.domain.errors import (
    BusinessTripWithoutPlaceError,
    CorrectionTargetNotFoundError,
    DailyServiceTimeLimitExceededError,
    EventOutsideTimesheetPeriodError,
    OverlappingServiceTimeEventError,
    OvertimeOrderNumberTakenError,
    OvertimeWithoutOrderError,
    TimesheetApprovedError,
    TimesheetNotFoundError,
    TimesheetPeriodAlreadyOpenError,
    TimesheetReopenError,
)
from src.modules.time_accounting.domain.overtime_order import OvertimeOrder
from src.modules.time_accounting.domain.timesheet import (
    CorrectionEntry,
    ServiceTimeEvent,
    Timesheet,
)
from src.modules.time_accounting.infrastructure.read.projection import (
    HoursBreakdownProjectionRepository,
)
from src.modules.time_accounting.infrastructure.read.queries import (
    HoursBreakdownRow,
    get_hours_breakdown_history,
    get_timesheet_summary,
    get_unit_dashboard,
)
from src.modules.time_accounting.infrastructure.write.adapters import (
    LegalRulesConflictPolicy,
    LegalRulesNormRule,
    PersonnelEmployeeCalculationContext,
    PersonnelEmployeeExistence,
    SchedulingPlannedShifts,
    ServiceCalendarProductionCalendar,
)
from src.modules.time_accounting.infrastructure.write.orm_mapping import outbox_message_table
from src.modules.time_accounting.infrastructure.write.repositories import (
    OvertimeOrderRepository,
    TimesheetRepository,
)

router = APIRouter()

SessionDep = Annotated[AsyncSession, Depends(get_session)]
IdempotencyKeyDep = Annotated[UUID, Header(alias="Idempotency-Key")]

_problem = problem_exception

_TIMESHEET_OVERLAP_CONSTRAINT = "excl_service_time_event_no_overlap"
_EMPLOYEE_OVERLAP_CONSTRAINT = "excl_actual_shift_employee_no_overlap"

def _to_event_response(event: ServiceTimeEvent) -> ServiceTimeEventResponse:
    return ServiceTimeEventResponse(
        id=event.id,
        timesheet_id=event.timesheet_id,
        event_type=event.event_type,
        start_time=event.time_range.start,
        end_time=event.time_range.end,
        planned_shift_id=event.planned_shift_id,
        overtime_order_id=event.overtime_order_id,
        business_trip_place=event.business_trip_place,
    )


def _to_response(timesheet: Timesheet) -> TimesheetResponse:
    return TimesheetResponse(
        id=timesheet.id,
        employee_id=timesheet.employee_id,
        period_type=timesheet.period.period_type,
        period_start=timesheet.period.start,
        period_end=timesheet.period.end,
        status=timesheet.status,
        events=[_to_event_response(e) for e in timesheet.events],
    )


def _to_correction_response(entry: CorrectionEntry) -> CorrectionEntryResponse:
    return CorrectionEntryResponse(
        id=entry.id,
        timesheet_id=entry.timesheet_id,
        original_event_id=entry.original_event_id,
        reason=entry.reason,
        created_at=entry.created_at,
        created_by=entry.created_by,
    )


def _to_order_response(order: OvertimeOrder) -> OvertimeOrderResponse:
    return OvertimeOrderResponse(
        id=order.id,
        order_number=order.order_number,
        issued_date=order.issued_date,
        issued_by=order.issued_by,
        reason=order.reason,
    )


@router.post("/timesheets", response_model=TimesheetResponse, status_code=201)
async def open_timesheet(
    request: CreateTimesheetRequest, session: SessionDep, idempotency_key: IdempotencyKeyDep
) -> TimesheetResponse:
    handler = OpenTimesheetHandler(
        session, TimesheetRepository(session), PersonnelEmployeeExistence(session)
    )
    try:
        timesheet = await handler.handle(
            OpenTimesheetCommand(
                employee_id=request.employee_id,
                period_type=request.period_type,
                period_start=request.period_start,
                period_end=request.period_end,
            )
        )
    except TimesheetPeriodAlreadyOpenError as exc:
        raise _problem(
            409, "overlapping-interval", "Табель на этот период уже открыт", str(exc)
        ) from exc
    except TimesheetNotFoundError as exc:
        raise _problem(404, "not-found", "Сотрудник не найден", str(exc)) from exc
    except ValueError as exc:
        raise _problem(400, "validation-failed", "Некорректный период", str(exc)) from exc

    return _to_response(timesheet)


@router.get("/timesheets/{timesheet_id}", response_model=TimesheetResponse)
async def get_timesheet(
    timesheet_id: Annotated[UUID, Path()], session: SessionDep
) -> TimesheetResponse:
    timesheet = await TimesheetRepository(session).get(timesheet_id)
    if timesheet is None:
        raise _problem(404, "not-found", "Табель не найден", f"Timesheet {timesheet_id}")
    return _to_response(timesheet)


@router.post(
    "/timesheets/{timesheet_id}/events",
    response_model=ServiceTimeEventResponse,
    status_code=201,
)
async def register_service_time_event(
    timesheet_id: Annotated[UUID, Path()],
    request: CreateServiceTimeEventRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> ServiceTimeEventResponse:
    handler = RegisterServiceTimeEventHandler(
        session,
        TimesheetRepository(session),
        OvertimeOrderRepository(session),
        OutboxWriter(session, outbox_message_table),
        DailyServiceTimeLimitService(),
        PersonnelEmployeeCalculationContext(session),
    )
    try:
        event = await handler.handle(
            RegisterServiceTimeEventCommand(
                timesheet_id=timesheet_id,
                event_type=request.event_type,
                start_time=request.start_time,
                end_time=request.end_time,
                planned_shift_id=request.planned_shift_id,
                overtime_order_id=request.overtime_order_id,
                business_trip_place=request.business_trip_place,
            )
        )
    except TimesheetNotFoundError as exc:
        raise _problem(404, "not-found", "Табель не найден", str(exc)) from exc
    except OverlappingServiceTimeEventError as exc:
        raise _problem(
            409, "overlapping-interval", "Пересечение с существующим фактом", str(exc)
        ) from exc
    except TimesheetApprovedError as exc:
        raise _problem(423, "immutable-resource", "Табель утверждён", str(exc)) from exc
    except OvertimeWithoutOrderError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Нужен приказ-основание", str(exc)
        ) from exc
    except BusinessTripWithoutPlaceError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Не указано место командировки", str(exc)
        ) from exc
    except DailyServiceTimeLimitExceededError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Превышен суточный предел 24 ч", str(exc)
        ) from exc
    except EventOutsideTimesheetPeriodError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Событие вне периода табеля", str(exc)
        ) from exc
    except ValueError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Некорректный интервал", str(exc)
        ) from exc
    except IntegrityError as exc:
        await session.rollback()
        text = str(exc)
        if _TIMESHEET_OVERLAP_CONSTRAINT in text:
            raise _problem(
                409,
                "overlapping-interval",
                "Пересечение с существующим фактом",
                "факт пересекается с уже зарегистрированным в этом табеле",
            ) from exc
        if _EMPLOYEE_OVERLAP_CONSTRAINT in text:
            # Инвариант 6.1.6: пересечение фактических смен через границу
            # двух табелей. Именно 422, а не 409, — openapi описывает
            # «суточный лимит 24ч на сотрудника превышен» как 422.
            raise _problem(
                422,
                "domain-invariant-violation",
                "Превышен суточный предел 24 ч",
                "фактическая смена пересекается со сменой этого сотрудника из "
                "соседнего табеля (Domain Model инвариант 6.1.6)",
            ) from exc
        raise

    return _to_event_response(event)


@router.post(
    "/timesheets/{timesheet_id}/corrections",
    response_model=CorrectionEntryResponse,
    status_code=201,
)
async def create_correction_entry(
    timesheet_id: Annotated[UUID, Path()],
    request: CreateCorrectionEntryRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> CorrectionEntryResponse:
    handler = CreateCorrectionEntryHandler(session, TimesheetRepository(session))
    try:
        entry = await handler.handle(
            CreateCorrectionEntryCommand(
                timesheet_id=timesheet_id,
                original_event_id=request.original_event_id,
                reason=request.reason,
                # TODO(auth): читать из JWT `sub` (API_Conventions разд. 2);
                # случайный UUID — заглушка, а не личность.
                created_by=uuid4(),
            )
        )
    except TimesheetNotFoundError as exc:
        raise _problem(404, "not-found", "Табель не найден", str(exc)) from exc
    except CorrectionTargetNotFoundError as exc:
        raise _problem(404, "not-found", "Исправляемый факт не найден", str(exc)) from exc
    except TimesheetApprovedError as exc:
        raise _problem(423, "immutable-resource", "Табель утверждён", str(exc)) from exc
    except ValueError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Некорректная причина", str(exc)
        ) from exc

    return _to_correction_response(entry)


@router.post("/timesheets/{timesheet_id}/approve", response_model=TimesheetResponse)
async def approve_timesheet(
    timesheet_id: Annotated[UUID, Path()],
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> TimesheetResponse:
    handler = ApproveTimesheetHandler(
        session,
        TimesheetRepository(session),
        OutboxWriter(session, outbox_message_table),
        PersonnelEmployeeCalculationContext(session),
        HoursBreakdownPipeline(
            norm_rules=LegalRulesNormRule(session),
            calendar=ServiceCalendarProductionCalendar(session),
            conflict_policy=LegalRulesConflictPolicy(session),
            planned_shifts=SchedulingPlannedShifts(session),
        ),
        HoursBreakdownProjectionRepository(session),
    )
    try:
        timesheet, _breakdown = await handler.handle(
            ApproveTimesheetCommand(timesheet_id=timesheet_id)
        )
    except TimesheetNotFoundError as exc:
        raise _problem(404, "not-found", "Табель не найден", str(exc)) from exc
    except TimesheetApprovedError as exc:
        raise _problem(423, "immutable-resource", "Табель уже утверждён", str(exc)) from exc
    except RuleVersionNotApplicable as exc:
        raise _problem(
            422, "rule-version-not-found", "Не найдена действующая норма", str(exc)
        ) from exc
    except ConflictPolicyNotApplicable as exc:
        raise _problem(
            422,
            "rule-version-not-found",
            "Не найдена действующая политика приоритетов категорий",
            str(exc),
        ) from exc
    except CalendarPeriodUnavailable as exc:
        raise _problem(
            422, "domain-invariant-violation", "Производственный календарь недоступен", str(exc)
        ) from exc
    except CalendarGapError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Пробел в производственном календаре", str(exc)
        ) from exc
    except UnresolvableCategoryError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Категорию часов некуда отнести", str(exc)
        ) from exc

    return _to_response(timesheet)


@router.post("/timesheets/{timesheet_id}/reopen", response_model=TimesheetResponse)
async def reopen_timesheet(
    timesheet_id: Annotated[UUID, Path()],
    request: ReopenTimesheetRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> TimesheetResponse:
    handler = ReopenTimesheetHandler(
        session, TimesheetRepository(session), OutboxWriter(session, outbox_message_table)
    )
    try:
        timesheet = await handler.handle(
            ReopenTimesheetCommand(timesheet_id=timesheet_id, reason=request.reason)
        )
    except TimesheetNotFoundError as exc:
        raise _problem(404, "not-found", "Табель не найден", str(exc)) from exc
    except TimesheetReopenError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Табель нельзя переоткрыть", str(exc)
        ) from exc

    return _to_response(timesheet)


@router.post("/overtime-orders", response_model=OvertimeOrderResponse, status_code=201)
async def create_overtime_order(
    request: CreateOvertimeOrderRequest, session: SessionDep, idempotency_key: IdempotencyKeyDep
) -> OvertimeOrderResponse:
    handler = CreateOvertimeOrderHandler(session, OvertimeOrderRepository(session))
    try:
        order = await handler.handle(
            CreateOvertimeOrderCommand(
                order_number=request.order_number,
                issued_date=request.issued_date,
                # TODO(auth): см. выше.
                issued_by=uuid4(),
                reason=request.reason,
            )
        )
    except OvertimeOrderNumberTakenError as exc:
        raise _problem(
            409, "conflict", "Приказ с таким номером уже зарегистрирован", str(exc)
        ) from exc
    except ValueError as exc:
        raise _problem(422, "validation-failed", "Некорректный приказ", str(exc)) from exc

    return _to_order_response(order)


# ------------------------------------------------------- Query-сторона
#
# TA033. Читает ТОЛЬКО проекцию: ни один из трёх запросов не обращается к
# `timesheet` или `service_time_event` (Architecture разд. 8.2). Именно
# поэтому у них нет ни одного `try` вокруг доменных исключений — читать
# нечему падать, а отсутствие строки означает «период ещё не утверждён».


def _to_breakdown_response(row: HoursBreakdownRow) -> HoursBreakdownResponse:
    return HoursBreakdownResponse(
        timesheet_id=row.timesheet_id,
        employee_id=row.employee_id,
        period_start=row.period_start,
        period_end=row.period_end,
        norm_hours=row.norm_hours,
        actual_hours=row.actual_hours,
        night_hours=row.night_hours,
        holiday_hours=row.holiday_hours,
        weekend_hours=row.weekend_hours,
        overtime_hours=row.overtime_hours,
        underworked_hours=row.underworked_hours,
        underworked_explained_hours=row.underworked_explained_hours,
        computed_from_rule_version_id=row.computed_from_rule_version_id,
        used_conflict_policy_version_id=row.used_conflict_policy_version_id,
        computed_from_legal_base=row.computed_from_legal_base,
        computed_in_time_zone=row.computed_in_time_zone,
        computed_at=row.computed_at,
    )


@router.get(
    "/employees/{employee_id}/timesheet-summary", response_model=HoursBreakdownResponse
)
async def get_employee_timesheet_summary(
    employee_id: Annotated[UUID, Path()],
    session: SessionDep,
    period_start: Annotated[date, Query(alias="periodStart")],
    period_end: Annotated[date, Query(alias="periodEnd")],
) -> HoursBreakdownResponse:
    row = await get_timesheet_summary(
        session, employee_id=employee_id, period_start=period_start, period_end=period_end
    )
    if row is None:
        raise _problem(
            404,
            "not-found",
            "Сводка не найдена",
            f"за период [{period_start}, {period_end}) табель сотрудника {employee_id} "
            f"не утверждён — сводка появляется в момент утверждения",
        )
    return _to_breakdown_response(row)


@router.get(
    "/employees/{employee_id}/hours-breakdown-history",
    response_model=list[HoursBreakdownResponse],
)
async def get_employee_hours_breakdown_history(
    employee_id: Annotated[UUID, Path()],
    session: SessionDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=100)] = 20,
) -> list[HoursBreakdownResponse]:
    rows = await get_hours_breakdown_history(
        session, employee_id=employee_id, page=page, page_size=page_size
    )
    return [_to_breakdown_response(row) for row in rows]


@router.get(
    "/units/{unit_id}/timesheet-dashboard", response_model=UnitTimesheetDashboardResponse
)
async def get_unit_timesheet_dashboard(
    unit_id: Annotated[UUID, Path()],
    session: SessionDep,
    period_start: Annotated[date, Query(alias="periodStart")],
    period_end: Annotated[date, Query(alias="periodEnd")],
) -> UnitTimesheetDashboardResponse:
    # Состав подразделения спрашивается у `personnel` через контракт, а не
    # межсхемным join'ом: граница модулей проходит здесь же, где и в
    # остальном коде (PostgreSQL_Logical_Model разд. 10).
    employee_ids = await list_employee_ids_of_unit(session, unit_id=unit_id)
    dashboard = await get_unit_dashboard(
        session,
        unit_id=unit_id,
        employee_ids=employee_ids,
        period_start=period_start,
        period_end=period_end,
    )
    return UnitTimesheetDashboardResponse(
        unit_id=dashboard.unit_id,
        period_start=dashboard.period_start,
        period_end=dashboard.period_end,
        total_employees=dashboard.total_employees,
        total_overtime_hours=dashboard.total_overtime_hours,
        total_underworked_hours=dashboard.total_underworked_hours,
        pending_approval_count=dashboard.pending_approval_count,
    )
