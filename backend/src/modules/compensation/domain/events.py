"""Доменные события Compensation (Domain Model разд. 11).

`CompensationCaseFinalized` таблица разд. 11 называет прямо;
`CompensationLineCreated` — нет, но он требуется задачей CO009 («финализация
публикует CompensationLineCreated для каждой строки») и CO020 («RestBalance
валидирует входящее событие по опубликованной схеме»), то есть у него есть
названный потребитель за границей модуля. Это ровно тот критерий, по
которому таблица разд. 11 отбирает события: значимость определяется
наличием последствия вовне.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID

from src.building_blocks.domain.domain_event import DomainEvent
from src.modules.compensation.domain.value_objects import CompensationForm, HourCategory


@dataclass(frozen=True, kw_only=True)
class CompensationLineCreated(DomainEvent):
    """Строка начисления зафиксирована окончательно.

    Потребитель конкретен и назван: `rest_balance` начисляет
    дополнительные сутки отдыха по строкам с формой
    `additional_rest_time` (Алгоритм Л). Именно поэтому событие несёт
    форму и категорию, а не только часы: без них подписчик не может
    решить, касается ли его эта строка, и обязан был бы спросить обратно —
    то есть модули стали бы зависеть друг от друга в обе стороны.

    `legal_basis_rule_version_id` — провенанс: начисленные сутки отдыха
    обязаны быть объяснимы ссылкой на норму, по которой они возникли
    (инвариант 8.1.2 — «начисление не из воздуха»).
    """

    case_id: UUID
    line_id: UUID
    employee_id: UUID
    hour_category: HourCategory
    hours_amount: Decimal
    compensation_form: CompensationForm
    legal_basis_rule_version_id: UUID
    period_start: date
    period_end: date


@dataclass(frozen=True, kw_only=True)
class CompensationCaseFinalized(DomainEvent):
    """«Компенсация по периоду определена окончательно» (Domain Model
    разд. 11).

    Несёт `line_count`, а не сами строки: подписчик, которому нужны
    строки, получает их отдельными `CompensationLineCreated`, а этому
    событию достаточно сообщить, что период закрыт и сколько начислений в
    нём было — этого хватает для сверки «все ли строки дошли».
    """

    case_id: UUID
    employee_id: UUID
    timesheet_id: UUID
    period_start: date
    period_end: date
    line_count: int
