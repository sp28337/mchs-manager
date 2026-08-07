"""PE011 — `personnel` API router.

Presentation-layer rule (Architecture разд. 3): knows Application
(Command/Query + Handler) and nothing of `domain` beyond the exception
types it maps to status codes. Like `legal_rules`' router it constructs
concrete repositories inline, because there is no DI container
assembling handlers yet — infrastructure wiring, not business logic.
The shared DB-session dependency comes from `building_blocks`, never
from `composition/di.py`, so that this module does not reach every
other module through the Composition Root.

Domain exception -> RFC 7807 mapping follows API_Conventions_FPS.md разд.
3's catalog: `404` not-found, `409` uniqueness/overlap, `422`
domain-invariant violation, `423` immutable resource.

Every state-changing operation in `openapi.yaml` declares a required
`Idempotency-Key` header. It is accepted and validated as a header here,
but **not yet honoured**: replay suppression needs the Redis-backed store
described in Backend_Architecture разд. 4 ("Хранилище `Idempotency-Key`...
значение — сериализованный ответ первого выполнения"), which no module
has wired up. Declaring the header without the store would be worse than
useless if it were silent — so it is stated here, and the same gap exists
in `legal_rules`' router, which does not declare the header at all.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.application.problem import problem_exception
from src.building_blocks.infrastructure.db import get_session
from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.personnel.api.schemas import (
    ChangeEmploymentStatusRequest,
    CreateEmployeeRequest,
    CreatePositionRequest,
    CreateServiceRecordEntryRequest,
    CreateUnitRequest,
    EmployeeListEnvelopeResponse,
    EmployeeResponse,
    PositionResponse,
    ServiceRecordEntryResponse,
    UnitResponse,
)
from src.modules.personnel.application.commands.add_service_record_entry.command import (
    AddServiceRecordEntryCommand,
)
from src.modules.personnel.application.commands.add_service_record_entry.handler import (
    AddServiceRecordEntryHandler,
)
from src.modules.personnel.application.commands.change_employment_status.command import (
    ChangeEmploymentStatusCommand,
)
from src.modules.personnel.application.commands.change_employment_status.handler import (
    ChangeEmploymentStatusHandler,
)
from src.modules.personnel.application.commands.create_position.command import (
    CreatePositionCommand,
)
from src.modules.personnel.application.commands.create_position.handler import (
    CreatePositionHandler,
)
from src.modules.personnel.application.commands.create_unit.command import CreateUnitCommand
from src.modules.personnel.application.commands.create_unit.handler import CreateUnitHandler
from src.modules.personnel.application.commands.register_employee.command import (
    RegisterEmployeeCommand,
)
from src.modules.personnel.application.commands.register_employee.handler import (
    RegisterEmployeeHandler,
)
from src.modules.personnel.application.queries.get_employee.handler import GetEmployeeHandler
from src.modules.personnel.application.queries.get_employee.query import GetEmployeeQuery
from src.modules.personnel.application.queries.get_unit.handler import GetUnitHandler
from src.modules.personnel.application.queries.get_unit.query import GetUnitQuery
from src.modules.personnel.application.queries.list_employees.handler import ListEmployeesHandler
from src.modules.personnel.application.queries.list_employees.query import ListEmployeesQuery
from src.modules.personnel.application.queries.list_service_record_entries.handler import (
    ListServiceRecordEntriesHandler,
)
from src.modules.personnel.application.queries.list_service_record_entries.query import (
    ListServiceRecordEntriesQuery,
)
from src.modules.personnel.application.queries.list_units.handler import ListUnitsHandler
from src.modules.personnel.application.queries.list_units.query import ListUnitsQuery
from src.modules.personnel.domain.employee import Employee
from src.modules.personnel.domain.errors import (
    EmployeeDismissedError,
    EmployeeNotFoundError,
    InvalidEmploymentStatusTransitionError,
    PersonnelNumberAlreadyExistsError,
    PositionCodeAlreadyExistsError,
    PositionNotFoundError,
    ServiceRecordBackdatedError,
    UnitCodeAlreadyExistsError,
    UnitNotFoundError,
)
from src.modules.personnel.domain.service_record import ServiceRecordEntry
from src.modules.personnel.domain.unit import Unit
from src.modules.personnel.infrastructure.orm_mapping import outbox_message_table
from src.modules.personnel.infrastructure.repositories import (
    EmployeeRepository,
    PositionRepository,
    UnitRepository,
)

router = APIRouter()

SessionDep = Annotated[AsyncSession, Depends(get_session)]

# See the module docstring: declared per `openapi.yaml`, not yet honoured.
IdempotencyKeyDep = Annotated[UUID, Header(alias="Idempotency-Key")]

_problem = problem_exception


def _to_unit_response(unit: Unit) -> UnitResponse:
    return UnitResponse(
        id=unit.id,
        code=unit.code,
        name=unit.name,
        parent_unit_id=unit.parent_unit_id,
        hierarchy_path=unit.hierarchy_path.as_ltree(),
        time_zone=unit.time_zone,
    )


def _to_employee_response(employee: Employee) -> EmployeeResponse:
    return EmployeeResponse(
        id=employee.id,
        personnel_number=employee.personnel_number,
        full_name=employee.full_name,
        rank=employee.rank,
        legal_base=employee.legal_base,
        service_condition_category=employee.service_condition_category,
        current_position_id=employee.current_position_id,
        current_unit_id=employee.current_unit_id,
        hired_at=employee.hired_at,
        employment_status=employee.employment_status,
        dismissed_at=employee.dismissed_at,
    )


def _to_service_record_response(entry: ServiceRecordEntry) -> ServiceRecordEntryResponse:
    assert entry.recorded_at is not None, "a persisted entry always carries recorded_at"
    return ServiceRecordEntryResponse(
        id=entry.id,
        employee_id=entry.employee_id,
        event_type=entry.event_type,
        effective_date=entry.effective_date,
        position_id=entry.position_id,
        unit_id=entry.unit_id,
        rank=entry.rank,
        legal_base=entry.legal_base,
        recorded_at=entry.recorded_at,
    )


# ------------------------------------------------------------------- units


@router.post("/units", response_model=UnitResponse, status_code=201)
async def create_unit(
    request: CreateUnitRequest, session: SessionDep, idempotency_key: IdempotencyKeyDep
) -> UnitResponse:
    handler = CreateUnitHandler(session, UnitRepository(session))
    try:
        unit = await handler.handle(
            CreateUnitCommand(
                code=request.code,
                name=request.name,
                parent_unit_id=request.parent_unit_id,
                time_zone=request.time_zone,
            )
        )
    except UnitCodeAlreadyExistsError as exc:
        raise _problem(
            409, "unit-code-conflict", "Код подразделения уже используется", str(exc)
        ) from exc
    except UnitNotFoundError as exc:
        raise _problem(404, "not-found", "Родительское подразделение не найдено", str(exc)) from exc

    return _to_unit_response(unit)


@router.get("/units", response_model=list[UnitResponse])
async def list_units(
    session: SessionDep,
    root_unit_id: Annotated[UUID | None, Query(alias="rootUnitId")] = None,
) -> list[UnitResponse]:
    """Дополнение к `openapi.yaml` — см. `ListUnitsQuery`.

    Без конверта `items/page/pageSize/totalCount`, в отличие от
    `GET /personnel/employees`. Конверт существует ради страниц, а эта
    выдача не постраничная: дерево, разрезанное на страницы, перестаёт
    быть деревом. Пустой конверт вокруг полного ответа обещал бы
    постраничность, которой нет.
    """
    handler = ListUnitsHandler(UnitRepository(session))
    try:
        units = await handler.handle(ListUnitsQuery(root_unit_id=root_unit_id))
    except UnitNotFoundError as exc:
        raise _problem(404, "not-found", "Подразделение не найдено", str(exc)) from exc
    return [_to_unit_response(unit) for unit in units]


@router.get("/units/{unit_id}", response_model=UnitResponse)
async def get_unit(unit_id: Annotated[UUID, Path()], session: SessionDep) -> UnitResponse:
    handler = GetUnitHandler(UnitRepository(session))
    try:
        unit = await handler.handle(GetUnitQuery(unit_id=unit_id))
    except UnitNotFoundError as exc:
        raise _problem(404, "not-found", "Подразделение не найдено", str(exc)) from exc
    return _to_unit_response(unit)


# --------------------------------------------------------------- positions


@router.post("/positions", response_model=PositionResponse, status_code=201)
async def create_position(
    request: CreatePositionRequest, session: SessionDep, idempotency_key: IdempotencyKeyDep
) -> PositionResponse:
    handler = CreatePositionHandler(session, PositionRepository(session))
    try:
        position = await handler.handle(
            CreatePositionCommand(
                code=request.code,
                title=request.title,
                category=request.category,
                default_regime_type=request.default_regime_type,
            )
        )
    except PositionCodeAlreadyExistsError as exc:
        raise _problem(
            409, "position-code-conflict", "Код должности уже используется", str(exc)
        ) from exc

    return PositionResponse(
        id=position.id,
        code=position.code,
        title=position.title,
        category=position.category,
        default_regime_type=position.default_regime_type,
    )


# --------------------------------------------------------------- employees


@router.post("/employees", response_model=EmployeeResponse, status_code=201)
async def register_employee(
    request: CreateEmployeeRequest, session: SessionDep, idempotency_key: IdempotencyKeyDep
) -> EmployeeResponse:
    handler = RegisterEmployeeHandler(
        session,
        EmployeeRepository(session),
        UnitRepository(session),
        PositionRepository(session),
        OutboxWriter(session, outbox_message_table),
    )
    try:
        employee = await handler.handle(
            RegisterEmployeeCommand(
                personnel_number=request.personnel_number,
                full_name=request.full_name,
                rank=request.rank,
                legal_base=request.legal_base,
                service_condition_category=request.service_condition_category,
                current_position_id=request.current_position_id,
                current_unit_id=request.current_unit_id,
                hired_at=request.hired_at,
            )
        )
    except PersonnelNumberAlreadyExistsError as exc:
        raise _problem(
            409, "personnel-number-conflict", "Табельный номер уже используется", str(exc)
        ) from exc
    except (UnitNotFoundError, PositionNotFoundError) as exc:
        raise _problem(
            404, "not-found", "Подразделение или должность не найдены", str(exc)
        ) from exc

    return _to_employee_response(employee)


@router.get("/employees", response_model=EmployeeListEnvelopeResponse)
async def list_employees(
    session: SessionDep,
    unit_id: Annotated[UUID | None, Query(alias="unitId")] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=200)] = 50,
) -> EmployeeListEnvelopeResponse:
    handler = ListEmployeesHandler(EmployeeRepository(session))
    employees, total_count = await handler.handle(
        ListEmployeesQuery(unit_id=unit_id, page=page, page_size=page_size)
    )
    return EmployeeListEnvelopeResponse(
        items=[_to_employee_response(e) for e in employees],
        page=page,
        page_size=page_size,
        total_count=total_count,
    )


@router.get("/employees/{employee_id}", response_model=EmployeeResponse)
async def get_employee(
    employee_id: Annotated[UUID, Path()], session: SessionDep
) -> EmployeeResponse:
    handler = GetEmployeeHandler(EmployeeRepository(session))
    try:
        employee = await handler.handle(GetEmployeeQuery(employee_id=employee_id))
    except EmployeeNotFoundError as exc:
        raise _problem(404, "not-found", "Сотрудник не найден", str(exc)) from exc
    return _to_employee_response(employee)


@router.patch("/employees/{employee_id}/status", response_model=EmployeeResponse)
async def change_employment_status(
    employee_id: Annotated[UUID, Path()],
    request: ChangeEmploymentStatusRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> EmployeeResponse:
    handler = ChangeEmploymentStatusHandler(
        session, EmployeeRepository(session), OutboxWriter(session, outbox_message_table)
    )
    try:
        employee = await handler.handle(
            ChangeEmploymentStatusCommand(
                employee_id=employee_id,
                new_status=request.new_status,
                effective_date=request.effective_date,
                reason=request.reason,
            )
        )
    except EmployeeNotFoundError as exc:
        raise _problem(404, "not-found", "Сотрудник не найден", str(exc)) from exc
    except (InvalidEmploymentStatusTransitionError, ServiceRecordBackdatedError) as exc:
        raise _problem(
            422, "domain-invariant-violation", "Недопустимое изменение статуса", str(exc)
        ) from exc

    return _to_employee_response(employee)


@router.post(
    "/employees/{employee_id}/service-record-entries",
    response_model=ServiceRecordEntryResponse,
    status_code=201,
)
async def add_service_record_entry(
    employee_id: Annotated[UUID, Path()],
    request: CreateServiceRecordEntryRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> ServiceRecordEntryResponse:
    handler = AddServiceRecordEntryHandler(
        session,
        EmployeeRepository(session),
        UnitRepository(session),
        PositionRepository(session),
        OutboxWriter(session, outbox_message_table),
    )
    try:
        entry = await handler.handle(
            AddServiceRecordEntryCommand(
                employee_id=employee_id,
                event_type=request.event_type,
                effective_date=request.effective_date,
                position_id=request.position_id,
                unit_id=request.unit_id,
                rank=request.rank,
                legal_base=request.legal_base,
            )
        )
    except EmployeeNotFoundError as exc:
        raise _problem(404, "not-found", "Сотрудник не найден", str(exc)) from exc
    except (UnitNotFoundError, PositionNotFoundError) as exc:
        raise _problem(
            404, "not-found", "Подразделение или должность не найдены", str(exc)
        ) from exc
    except EmployeeDismissedError as exc:
        raise _problem(422, "domain-invariant-violation", "Сотрудник уволен", str(exc)) from exc
    except ServiceRecordBackdatedError as exc:
        raise _problem(
            422,
            "domain-invariant-violation",
            "Запись предшествует дате приёма на службу",
            str(exc),
        ) from exc
    except ValueError as exc:
        # `ServiceRecordEntry.__post_init__` mirrors the DB's
        # `ck_service_record_payload`: an `assignment` with no position,
        # a `rank_change` with no rank. A malformed body, hence 400.
        raise _problem(
            400, "validation-failed", "Неполные данные записи истории службы", str(exc)
        ) from exc

    return _to_service_record_response(entry)


@router.get(
    "/employees/{employee_id}/service-record-entries",
    response_model=list[ServiceRecordEntryResponse],
)
async def list_service_record_entries(
    employee_id: Annotated[UUID, Path()], session: SessionDep
) -> list[ServiceRecordEntryResponse]:
    handler = ListServiceRecordEntriesHandler(EmployeeRepository(session))
    try:
        entries = await handler.handle(ListServiceRecordEntriesQuery(employee_id=employee_id))
    except EmployeeNotFoundError as exc:
        raise _problem(404, "not-found", "Сотрудник не найден", str(exc)) from exc
    return [_to_service_record_response(e) for e in entries]
