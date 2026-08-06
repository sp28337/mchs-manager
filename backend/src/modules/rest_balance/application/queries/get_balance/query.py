"""Запрос текущего остатка ДДО (RB007)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from uuid import UUID


@dataclass(frozen=True, kw_only=True)
class GetBalanceQuery:
    """`as_of` необязателен: без него отдаётся остаток на сегодня.

    С датой остаток считается по журналу, а не по представлению —
    материализованный остаток знает только «сейчас», а вопрос «сколько
    было на 1 марта» возникает при разборе жалобы, и отвечать на него
    приблизительно нельзя.
    """

    employee_id: UUID
    as_of: date | None = None
