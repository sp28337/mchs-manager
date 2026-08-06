"""Value Objects модуля RestBalance (Domain Model разд. 8.1)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from src.building_blocks.domain.value_object import ValueObject


class MovementType(StrEnum):
    """Mirrors `rest_balance.movement_type` (миграция 0021)."""

    ACCRUAL = "accrual"
    CONSUMPTION = "consumption"


@dataclass(frozen=True, kw_only=True)
class MovementGround(ValueObject):
    """Основание движения — Domain Model разд. 8.1: «ссылка-основание:
    `CompensationLineId` для начисления или `RestUsageRequestId`/
    `LeaveGrantId` для списания».

    Отдельный тип, а не два `UUID | None` в сущности, потому что
    оснований может быть ровно одно и оно обязано соответствовать типу
    движения. Пара необязательных полей позволяла бы выразить движение с
    двумя основаниями и движение без единого — оба состояния не имеют
    смысла, и лучше, чтобы их нельзя было записать.
    """

    compensation_line_id: UUID | None = None
    leave_grant_id: UUID | None = None

    def __post_init__(self) -> None:
        filled = [x for x in (self.compensation_line_id, self.leave_grant_id) if x is not None]
        if len(filled) > 1:
            raise ValueError(
                "движение баланса ДДО имеет ровно одно основание: и строка "
                "компенсации, и предоставление отпуска одновременно — это два "
                "разных факта, и списывать по ним следует двумя движениями"
            )

    @classmethod
    def from_compensation_line(cls, line_id: UUID) -> MovementGround:
        return cls(compensation_line_id=line_id)

    @classmethod
    def from_leave_grant(cls, grant_id: UUID) -> MovementGround:
        return cls(leave_grant_id=grant_id)

    @property
    def is_empty(self) -> bool:
        return self.compensation_line_id is None and self.leave_grant_id is None

    def __composite_values__(self) -> tuple[UUID | None, UUID | None]:
        """Порядок обязан совпадать с порядком колонок в `composite()`
        (`infrastructure/orm_mapping.py`)."""
        return self.compensation_line_id, self.leave_grant_id


@dataclass(frozen=True, kw_only=True)
class RestDays(ValueObject):
    """Сутки отдыха.

    `Decimal`, а не `float`, по той же причине, что часы в
    `HoursBreakdown`: это то, что сотруднику причитается, и
    `0.1 + 0.2 != 0.3` здесь означало бы потерянные полдня однажды.

    Ноль запрещён вместе с отрицательными значениями: движение на ноль
    суток не начисление и не списание, а запись о том, что ничего не
    произошло. Направление задаёт `MovementType`, а не знак величины —
    зеркало `ck_balance_movement_amount_positive`.
    """

    days: Decimal

    def __post_init__(self) -> None:
        if self.days <= 0:
            raise ValueError(
                f"движение баланса ДДО на {self.days} сут. не имеет смысла: "
                f"величина строго положительна, направление задаёт тип движения"
            )

    def __add__(self, other: RestDays) -> RestDays:
        return RestDays(days=self.days + other.days)

    def __composite_values__(self) -> tuple[Decimal]:
        return (self.days,)


@dataclass(frozen=True, kw_only=True)
class BalancePeriod(ValueObject):
    """Полуинтервал `[start, end)` для выборки движений.

    Полуоткрытый — как везде в кодовой базе: `end` первого периода и
    `start` второго совпадают, и ни одно движение не попадает в два
    периода сразу.
    """

    start: date
    end: date

    def __post_init__(self) -> None:
        if self.end <= self.start:
            raise ValueError("конец периода должен быть строго позже начала")

    def contains(self, day: date) -> bool:
        return self.start <= day < self.end
