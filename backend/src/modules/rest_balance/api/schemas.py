"""RB009 — DTO эндпоинтов `/rest-balance` (`openapi.yaml`).

Отступления от спецификации — ADDITIVE, каждое названо.

`BalanceMovement.reversedByMovementId` спецификации отдаётся как
`reversesMovementId`: связь лежит на СТОРНИРУЮЩЕЙ строке и указывает на
исправляемую, а не наоборот (см. докстринг миграции 0021 — иначе сторно
требовало бы `UPDATE` неизменяемой записи). Имя из спецификации при таком
направлении означало бы обратное тому, что в поле лежит.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from src.modules.rest_balance.domain.value_objects import MovementType


class RestBalanceResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    employee_id: UUID = Field(alias="employeeId")
    balance_days: Decimal = Field(alias="balanceDays")
    # ADDITIVE: без этих двух полей нельзя отличить «остаток на сегодня,
    # посчитанный с отставанием» от «остаток на дату, выведенный из
    # журнала», — а числа они дают разные, и по разным причинам.
    as_of: date | None = Field(default=None, alias="asOf")
    computed_from_journal: bool = Field(alias="computedFromJournal")


class BalanceMovementResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    employee_id: UUID = Field(alias="employeeId")
    movement_type: MovementType = Field(alias="movementType")
    amount_days: Decimal = Field(alias="amountDays")
    movement_date: date = Field(alias="movementDate")
    compensation_line_id: UUID | None = Field(default=None, alias="compensationLineId")
    leave_grant_id: UUID | None = Field(default=None, alias="leaveGrantId")
    reverses_movement_id: UUID | None = Field(default=None, alias="reversesMovementId")
    # ADDITIVE: инвариант 8.1.3 требует сторно «с указанием причины», и
    # причина, недоступная в журнале, не помогает служебной проверке —
    # ради которой она и записывается.
    reversal_reason: str | None = Field(default=None, alias="reversalReason")
    created_at: datetime = Field(alias="createdAt")


class CreateConsumptionRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    amount_days: Decimal = Field(alias="amountDays", gt=0, le=60)
    movement_date: date = Field(alias="movementDate")
    # ADDITIVE и необязательное: сутки используются либо отдельным
    # отгулом, либо присоединением к отпуску (Приказ № 410 п. 12), и
    # второе оформляет `leave_management`, который пришлёт свой
    # идентификатор.
    leave_grant_id: UUID | None = Field(default=None, alias="leaveGrantId")


class ReverseMovementRequest(BaseModel):
    """RB006. В спецификации эндпоинта нет — операция служебная, но и
    молча править журнал нельзя: сторно есть единственный законный способ
    исправить движение (инвариант 8.1.3), и он обязан быть доступен.
    """

    model_config = ConfigDict(populate_by_name=True)

    reason: str = Field(min_length=8, max_length=500)
    movement_date: date | None = Field(default=None, alias="movementDate")
