"""Команда списания ДДО (RB005)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID


@dataclass(frozen=True, kw_only=True)
class RequestConsumptionCommand:
    """Рапорт сотрудника на использование отгула.

    `leave_grant_id` необязателен: сутки используются либо отдельным
    отгулом (Приказ № 410 п. 12, «отдых предоставляется в другие дни
    недели»), либо присоединением к отпуску — и второе оформляется
    `leave_management`, который пришлёт свой идентификатор. Требовать его
    всегда значило бы запретить первое.
    """

    employee_id: UUID
    amount_days: Decimal
    movement_date: date
    leave_grant_id: UUID | None = None
