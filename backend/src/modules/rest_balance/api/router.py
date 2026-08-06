"""RB009 — роутер `/rest-balance`.

Отображение доменных исключений на каталог API_Conventions разд. 3:

* `404` — движение не найдено.
* `409` — движение уже сторнировано.
* `422` — остаток недостаточен (инвариант 8.1.1), сторно без причины.

`422` недостатка остатка несёт `balanceDays` и `requestedDays` в теле
проблемы: DoD RB005 требует, чтобы ответ называл текущий остаток — иначе
сотруднику остаётся угадывать, на сколько суток подавать рапорт.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.application.problem import problem_exception
from src.building_blocks.infrastructure.db import get_session
from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.rest_balance.api.schemas import (
    BalanceMovementResponse,
    CreateConsumptionRequest,
    RestBalanceResponse,
    ReverseMovementRequest,
)
from src.modules.rest_balance.application.commands.request_consumption.command import (
    RequestConsumptionCommand,
)
from src.modules.rest_balance.application.commands.request_consumption.handler import (
    RequestConsumptionHandler,
)
from src.modules.rest_balance.application.commands.reverse_movement.command import (
    ReverseMovementCommand,
)
from src.modules.rest_balance.application.commands.reverse_movement.handler import (
    ReverseMovementHandler,
)
from src.modules.rest_balance.application.queries.get_balance.handler import (
    GetBalanceHandler,
)
from src.modules.rest_balance.application.queries.get_balance.query import GetBalanceQuery
from src.modules.rest_balance.application.queries.get_movements.handler import (
    GetMovementsHandler,
)
from src.modules.rest_balance.application.queries.get_movements.query import GetMovementsQuery
from src.modules.rest_balance.domain.balance import BalanceMovement
from src.modules.rest_balance.domain.errors import (
    AlreadyReversedError,
    InsufficientBalanceError,
    MovementNotFoundError,
    ReversalReasonRequiredError,
)
from src.modules.rest_balance.infrastructure.orm_mapping import outbox_message_table
from src.modules.rest_balance.infrastructure.read_queries import (
    CurrentBalanceReader,
    MovementJournal,
)
from src.modules.rest_balance.infrastructure.repositories import RestDaysBalanceRepository

router = APIRouter()

SessionDep = Annotated[AsyncSession, Depends(get_session)]
IdempotencyKeyDep = Annotated[UUID, Header(alias="Idempotency-Key")]

_problem = problem_exception


def _to_response(movement: BalanceMovement) -> BalanceMovementResponse:
    return BalanceMovementResponse(
        id=movement.id,
        employee_id=movement.employee_id,
        movement_type=movement.movement_type,
        amount_days=movement.amount.days,
        movement_date=movement.movement_date,
        compensation_line_id=movement.ground.compensation_line_id,
        leave_grant_id=movement.ground.leave_grant_id,
        reverses_movement_id=movement.reverses_movement_id,
        reversal_reason=movement.reversal_reason,
        created_at=movement.created_at,
    )


@router.get("/employees/{employee_id}/balance", response_model=RestBalanceResponse)
async def get_balance(
    employee_id: Annotated[UUID, Path()],
    session: SessionDep,
    as_of: Annotated[str | None, Query(alias="asOf")] = None,
) -> RestBalanceResponse:
    """Остаток ДДО. Без `asOf` — «сейчас» из материализованного
    представления, с `asOf` — из журнала (см. докстринг обработчика)."""
    from datetime import date as _date

    handler = GetBalanceHandler(
        RestDaysBalanceRepository(session), CurrentBalanceReader(session)
    )
    view = await handler.handle(
        GetBalanceQuery(
            employee_id=employee_id,
            as_of=_date.fromisoformat(as_of) if as_of else None,
        )
    )
    return RestBalanceResponse(
        employee_id=view.employee_id,
        balance_days=view.balance_days,
        as_of=view.as_of,
        computed_from_journal=view.computed_from_journal,
    )


@router.get(
    "/employees/{employee_id}/movements", response_model=list[BalanceMovementResponse]
)
async def get_movements(
    employee_id: Annotated[UUID, Path()],
    session: SessionDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=100)] = 20,
) -> list[BalanceMovementResponse]:
    """Журнал движений, новые сверху.

    Массив, а не конверт с `totalCount`, — так в спецификации. Общее число
    уходит заголовком `X-Total-Count`... его здесь нет: заголовки
    `openapi.yaml` для этого эндпоинта не описывает, и добавлять
    недокументированный заголовок значило бы завести второй источник
    сведений о формате ответа.
    """
    handler = GetMovementsHandler(MovementJournal(session))
    result = await handler.handle(
        GetMovementsQuery(employee_id=employee_id, page=page, page_size=page_size)
    )
    return [_to_response(m) for m in result.items]


@router.post(
    "/employees/{employee_id}/consumption-requests",
    response_model=BalanceMovementResponse,
    status_code=201,
)
async def request_consumption(
    employee_id: Annotated[UUID, Path()],
    request: CreateConsumptionRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> BalanceMovementResponse:
    handler = RequestConsumptionHandler(
        session,
        RestDaysBalanceRepository(session),
        OutboxWriter(session, outbox_message_table),
    )
    try:
        movement = await handler.handle(
            RequestConsumptionCommand(
                employee_id=employee_id,
                amount_days=request.amount_days,
                movement_date=request.movement_date,
                leave_grant_id=request.leave_grant_id,
            )
        )
    except InsufficientBalanceError as exc:
        raise _problem(
            422,
            "insufficient-balance",
            "Остаток дополнительных суток отдыха недостаточен",
            str(exc),
            balanceDays=str(exc.balance),
            requestedDays=str(exc.requested),
        ) from exc

    return _to_response(movement)


@router.post(
    "/movements/{movement_id}/reversal",
    response_model=BalanceMovementResponse,
    status_code=201,
)
async def reverse_movement(
    movement_id: Annotated[UUID, Path()],
    request: ReverseMovementRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> BalanceMovementResponse:
    """Сторно — единственный законный способ исправить движение
    (инвариант 8.1.3). Исходная запись не изменяется."""
    handler = ReverseMovementHandler(
        session,
        RestDaysBalanceRepository(session),
        OutboxWriter(session, outbox_message_table),
    )
    try:
        movement = await handler.handle(
            ReverseMovementCommand(
                movement_id=movement_id,
                reason=request.reason,
                movement_date=request.movement_date,
            )
        )
    except MovementNotFoundError as exc:
        raise _problem(404, "not-found", "Движение не найдено", str(exc)) from exc
    except AlreadyReversedError as exc:
        raise _problem(409, "conflict", "Движение уже сторнировано", str(exc)) from exc
    except ReversalReasonRequiredError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Причина сторно обязательна", str(exc)
        ) from exc
    except InsufficientBalanceError as exc:
        raise _problem(
            422,
            "insufficient-balance",
            "Сторно начисления увело бы остаток в минус",
            str(exc),
            balanceDays=str(exc.balance),
            requestedDays=str(exc.requested),
        ) from exc

    return _to_response(movement)
