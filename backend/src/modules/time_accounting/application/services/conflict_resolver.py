"""TA022 — Алгоритм Ж: разрешение конфликта пересечения категорий.

Точка, отражающая инвариант Domain Model 2.3 (`ConflictResolutionPolicy`)
и требование SRS разд. 7.5 «не задваивать компенсацию».

--- Задача ------------------------------------------------------------

Час с 23:00 до 00:00 в ночь на 1 января одновременно ночной, праздничный
и (если 31 декабря выпало на субботу) выходной. Компенсировать его трижды
нельзя: это один отработанный час, а не три. Порядок приоритетов
(`precedence_list` действующей версии политики) решает, к какой ровно
одной категории он относится.

--- Как это сделано ----------------------------------------------------

Шаг 1 требует «построить временную шкалу как последовательность
непересекающихся элементарных отрезков, на каждом из которых набор
применимых категорий неизменен». Именно это и делает `_boundaries()`:
собирает ВСЕ границы всех «сырых» интервалов из Алгоритмов Г-Е, сортирует
и режет шкалу по ним. Внутри полученного отрезка ни одна категория не
может начаться или кончиться — иначе её граница была бы в списке.

Дальше каждый отрезок относится к первой применимой к нему категории из
`precedence_list` (шаг 4), и длительности суммируются (шаг 5).

--- Три решения, которые стоит назвать ---------------------------------

**Категория вне `precedence_list` не теряется молча.** Если политика
перечисляет `[holiday, weekend, night]`, а отрезок применим только к
категории, которой в списке нет, отнести его некуда. Это не «ноль», а
пробел в нормативном акте, и он поднимается ошибкой: молчаливое
отбрасывание превратило бы неполный акт в тихую потерю компенсируемых
часов.

**`overtime` в `precedence_list` игнорируется здесь.** Пример списка в
документе — `[holiday, weekend, night, overtime]`, но переработка это не
свойство ЧАСА, а свойство ПЕРИОДА: она вычисляется сравнением суммы
факта с нормой (Алгоритм З), и не существует часа, про который в
отдельности можно сказать «он сверхурочный». Позиция `overtime` в списке
поэтому на разбиение шкалы не влияет — она относится к следующему шагу
пайплайна.

**Пересечения сохраняются в служебной статистике.** Шаг 4 требует пометить
«применимые, но не выбранные» категории. Без этого невозможно ни
объяснить сотруднику, почему его праздничная ночь оплачена как
праздничная, ни проверить, что политика вообще применялась. В
компенсируемые суммы эта статистика не входит.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from src.building_blocks.domain.time_interval import TimeInterval
from src.modules.time_accounting.application.services.hours_classifier import (
    ClassifiedIntervals,
)

# Категории, которые не являются свойством часа — см. докстринг модуля.
_NOT_A_PROPERTY_OF_AN_HOUR = frozenset({"overtime", "underworked"})


class UnresolvableCategoryError(LookupError):
    """Отрезку применима категория, которой нет в `precedence_list`.

    Отображается в 422: это пробел в действующей политике, а не ошибка
    пользователя.
    """


@dataclass(frozen=True, kw_only=True)
class ResolvedHours:
    """Итог Алгоритма Ж — непротиворечивые часы по категориям."""

    hours_by_category: dict[str, Decimal]
    used_conflict_policy_version_id: UUID
    # Служебная (не компенсационная) статистика: сколько часов было
    # применимо более чем к одной категории — шаг 4.
    overlapping_hours: Decimal = Decimal(0)
    # Какие категории уступили и кому: {категория: часы, отданные другим}.
    yielded_hours: dict[str, Decimal] = field(default_factory=dict)

    def hours_of(self, category: str) -> Decimal:
        return self.hours_by_category.get(category, Decimal(0))


class ConflictResolutionService:
    """Чистая функция от классифицированных интервалов и порядка
    приоритетов."""

    def resolve(
        self,
        *,
        classified: ClassifiedIntervals,
        precedence_list: Sequence[str],
        policy_version_id: UUID,
    ) -> ResolvedHours:
        by_category = classified.by_category()
        order = [c for c in precedence_list if c not in _NOT_A_PROPERTY_OF_AN_HOUR]

        minutes_by_category: dict[str, float] = {category: 0.0 for category in by_category}
        yielded_minutes: dict[str, float] = {category: 0.0 for category in by_category}
        overlapping_minutes = 0.0

        for segment in _elementary_segments(by_category):
            applicable = [
                category
                for category, intervals in by_category.items()
                if _covers(intervals, segment)
            ]
            if not applicable:
                continue

            if len(applicable) > 1:
                overlapping_minutes += segment.duration_minutes()

            winner = next((category for category in order if category in applicable), None)
            if winner is None:
                raise UnresolvableCategoryError(
                    f"отрезок [{segment.start}, {segment.end}) применим к категориям "
                    f"{sorted(applicable)}, но действующая политика перечисляет "
                    f"{list(precedence_list)} — отнести его не к чему "
                    f"(Алгоритм Ж шаги 3-4)"
                )

            minutes_by_category[winner] += segment.duration_minutes()
            for category in applicable:
                if category != winner:
                    yielded_minutes[category] += segment.duration_minutes()

        return ResolvedHours(
            hours_by_category={
                category: _hours(minutes) for category, minutes in minutes_by_category.items()
            },
            used_conflict_policy_version_id=policy_version_id,
            overlapping_hours=_hours(overlapping_minutes),
            yielded_hours={
                category: _hours(minutes)
                for category, minutes in yielded_minutes.items()
                if minutes > 0
            },
        )


def _elementary_segments(
    by_category: dict[str, list[TimeInterval]],
) -> list[TimeInterval]:
    """Шаг 1: разбиение шкалы по всем границам всех категорий."""
    points: set[datetime] = set()
    for intervals in by_category.values():
        for interval in intervals:
            points.add(interval.start)
            points.add(interval.end)

    ordered = sorted(points)
    return [
        TimeInterval(start=start, end=end)
        for start, end in zip(ordered, ordered[1:], strict=False)
        if end > start
    ]


def _covers(intervals: list[TimeInterval], segment: TimeInterval) -> bool:
    """Отрезок целиком внутри одного из интервалов категории.

    Проверка на вложенность, а не на пересечение: отрезки элементарны, и
    частичного попадания у них быть не может — граница любого интервала
    категории является границей отрезка по построению. Пересечение здесь
    дало бы тот же ответ, но скрыло бы это свойство, а вместе с ним и
    ошибку, если оно вдруг перестанет выполняться.
    """
    return any(
        interval.start <= segment.start and segment.end <= interval.end
        for interval in intervals
    )


def _hours(minutes: float) -> Decimal:
    return (Decimal(str(minutes)) / Decimal(60)).quantize(Decimal("0.01"))
