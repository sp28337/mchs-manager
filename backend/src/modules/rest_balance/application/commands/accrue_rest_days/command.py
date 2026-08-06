"""Команда начисления ДДО по строке компенсации (Алгоритм Л)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID


@dataclass(frozen=True, kw_only=True)
class AccrueRestDaysCommand:
    """Начисление приходит из события `CompensationLineCreated`, а не из
    запроса пользователя: инвариант 8.1.2 — «начисление ДДО не может
    возникнуть из воздуха, вне процесса компенсации».

    `hours_amount`, а не `amount_days`: перевод часов в сутки — правило
    ведомственного акта, и выполняется оно в обработчике по действующей
    `RuleVersion`, а не отправителем события. Иначе коэффициент оказался
    бы зашит в двух модулях сразу.
    """

    employee_id: UUID
    compensation_line_id: UUID
    hours_amount: Decimal
    movement_date: date
    legal_basis_rule_version_id: UUID | None = None
