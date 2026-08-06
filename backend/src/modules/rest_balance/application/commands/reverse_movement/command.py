"""Команда сторно движения баланса (RB006)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from uuid import UUID


@dataclass(frozen=True, kw_only=True)
class ReverseMovementCommand:
    """Инвариант 8.1.3: ошибочное движение сторнируется симметричной
    обратной записью С УКАЗАНИЕМ ПРИЧИНЫ.

    `reason` обязателен и не имеет значения по умолчанию: движение,
    отменённое без объяснения, для служебной проверки неотличимо от
    ошибки оператора — а отличать их и есть смысл журнала.
    """

    movement_id: UUID
    reason: str
    movement_date: date | None = None
