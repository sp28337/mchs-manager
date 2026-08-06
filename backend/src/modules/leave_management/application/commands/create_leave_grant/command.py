"""Команда предоставления отпуска (LM005)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID


@dataclass(frozen=True, kw_only=True)
class CreateLeaveGrantCommand:
    """`period_end` — граница ИСКЛЮЧАЮЩАЯ.

    Отпуск по 20 марта включительно записывается как `end = 21 марта`.
    Так же во всей кодовой базе, и так же в `daterange` таблицы — иначе
    присоединение смежных отпусков (Приказ № 410 п. 12) считалось бы
    пересечением.

    `attached_rest_days` — сутки ДДО, присоединяемые к отпуску. Ноль
    означает «не присоединяем»; списание выполняет `rest_balance`, и
    отказ в нём отменяет всё предоставление.
    """

    employee_id: UUID
    leave_type: str
    period_start: date
    period_end: date
    attached_rest_days: Decimal = Decimal(0)
