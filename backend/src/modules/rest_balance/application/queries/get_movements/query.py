"""Запрос журнала движений (RB008)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from uuid import UUID


@dataclass(frozen=True, kw_only=True)
class GetMovementsQuery:
    employee_id: UUID
    period_start: date | None = None
    period_end: date | None = None
    page: int = 1
    page_size: int = 20
