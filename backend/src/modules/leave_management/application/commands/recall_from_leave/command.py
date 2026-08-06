"""Команда отзыва из отпуска (LM007)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from uuid import UUID


@dataclass(frozen=True, kw_only=True)
class RecallFromLeaveCommand:
    """Две даты, и разница между ними существенна: приказ издан третьего,
    а сотрудник обязан прибыть пятого. ФЗ-141 ст. 65 не отождествляет их,
    и система не вправе отождествлять тоже."""

    grant_id: UUID
    recall_date: date
    effective_from: date
