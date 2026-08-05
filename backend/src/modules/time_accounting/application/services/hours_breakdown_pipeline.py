"""TA026 — сборка полного пайплайна `HoursBreakdown`.

Общий пайплайн расчёта (Calculation_Engine_Algorithms разд. 1) целиком, в
том же порядке, в каком его перечисляет документ:

    Шаг 1  Определить применимую правовую базу       → Алгоритм А
    Шаг 2  Рассчитать норму учётного периода         → Алгоритм Б
    Шаг 3  Собрать и нормализовать факты периода     → Алгоритм В
    Шаги 4-6 Классифицировать ночные/праздничные/выходные → Алгоритмы Г-Е
    Шаг 7  Разрешить конфликт категорий              → Алгоритм Ж
    Шаг 8  Рассчитать переработку/недоработку        → Алгоритм З

Этот файл — единственное место, где порядок зафиксирован, и он ничего не
вычисляет сам: каждый шаг делает свой сервис, а здесь только передача
результатов. Если пайплайн начнёт содержать арифметику, значит какой-то
алгоритм оказался размазан между двумя файлами.

--- Алгоритм А, которого нет отдельным сервисом ------------------------

Шаг 1 сводится к чтению `legal_base` сотрудника и складыванию `scope`
(шаги 2-5 Алгоритма А), поэтому он выполняется здесь двумя строками, а не
отдельным классом: сервис, состоящий из одного обращения к контракту и
конструирования словаря, был бы церемонией вокруг ничего.

Что при этом важно и сделано: `legal_base` попадает в ПРОВЕНАНС
результата (`HoursBreakdown.legal_base`), как требует Алгоритм А шаг 4 —
«записать как атрибут расчёта, не как атрибут сотрудника целиком».

--- Детерминированность ------------------------------------------------

Инвариант 6.1.5 требует, чтобы повторный расчёт тех же входов дал
идентичный результат. Здесь это обеспечено тем, что в пайплайне нет
никакого состояния и ни одного обращения к текущему времени: всё, что
влияет на результат, приходит аргументами или из версионированных данных
на дату периода.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from zoneinfo import ZoneInfo

from src.modules.time_accounting.application.ports import (
    ConflictPolicyPort,
    EmployeeCalculationContext,
    NormRulePort,
    PlannedShiftsPort,
    ProductionCalendarPort,
)
from src.modules.time_accounting.application.services.conflict_resolver import (
    ConflictResolutionService,
)
from src.modules.time_accounting.application.services.fact_collector import (
    CollectedFacts,
    FactCollectorService,
)
from src.modules.time_accounting.application.services.hours_classifier import (
    CATEGORY_HOLIDAY,
    CATEGORY_NIGHT,
    CATEGORY_WEEKEND,
    HoursClassificationService,
)
from src.modules.time_accounting.application.services.norm_calculation import (
    NormCalculationService,
)
from src.modules.time_accounting.application.services.overtime_calculator import (
    OvertimeCalculationService,
)
from src.modules.time_accounting.domain.timesheet import Timesheet
from src.modules.time_accounting.domain.value_objects import HoursBreakdown


@dataclass(frozen=True, kw_only=True)
class CalculationOutcome:
    """`HoursBreakdown` плюс то, что нужно записать рядом с ним."""

    breakdown: HoursBreakdown
    time_zone: str


class HoursBreakdownPipeline:
    def __init__(
        self,
        *,
        norm_rules: NormRulePort,
        calendar: ProductionCalendarPort,
        conflict_policy: ConflictPolicyPort,
        planned_shifts: PlannedShiftsPort,
    ) -> None:
        self._norm_rules = norm_rules
        self._calendar = calendar
        self._conflict_policy = conflict_policy
        self._planned_shifts = planned_shifts

        self._norm = NormCalculationService(
            lambda as_of, scope: self._norm_rules.weekly_norm_hours(as_of=as_of, scope=scope),
            lambda start, end: self._calendar.count_days_by_type(
                period_start=start, period_end=end
            ),
        )
        self._facts = FactCollectorService()
        self._classifier = HoursClassificationService()
        self._conflicts = ConflictResolutionService()
        self._overtime = OvertimeCalculationService()

    async def run(
        self, *, timesheet: Timesheet, context: EmployeeCalculationContext
    ) -> CalculationOutcome:
        period_start = timesheet.period.start
        period_end = timesheet.period.end
        time_zone = ZoneInfo(context.time_zone)

        # --- Шаг 1 (Алгоритм А шаги 2-5) ---
        scope = {
            "legal_base": context.legal_base,
            "service_condition_category": context.service_condition_category,
        }

        # --- Шаг 2 (Алгоритм Б) ---
        norm = await self._norm.calculate(
            period_start=period_start,
            period_end=period_end,
            scope=scope,
            hired_at=context.hired_at,
            dismissed_at=context.dismissed_at,
        )

        # --- Шаг 3 (Алгоритм В) ---
        planned = await self._planned_shifts.planned_intervals(
            employee_id=timesheet.employee_id,
            period_start=period_start,
            period_end=period_end,
        )
        facts = self._facts.collect(timesheet=timesheet, planned_intervals=planned)

        # --- Шаги 4-6 (Алгоритмы Г, Д, Е) ---
        day_types = await self._calendar.day_types(
            period_start=period_start,
            period_end=_calendar_horizon(facts_end=_latest_end(facts, period_end)),
        )
        classified = self._classifier.classify(
            service_intervals=facts.service_intervals,
            day_types=day_types,
            time_zone=time_zone,
        )

        # --- Шаг 7 (Алгоритм Ж) ---
        precedence, policy_version_id = await self._conflict_policy.precedence_list(
            as_of=period_start
        )
        resolved = self._conflicts.resolve(
            classified=classified,
            precedence_list=precedence,
            policy_version_id=policy_version_id,
        )

        # --- Шаг 8 (Алгоритм З) ---
        totals = self._overtime.calculate(
            norm_hours=norm.norm_hours,
            actual_minutes_total=facts.actual_minutes_total,
            explained_absence_minutes=facts.explained_absence_minutes,
        )

        breakdown = HoursBreakdown(
            norm_hours=norm.norm_hours,
            actual_hours=totals.actual_hours,
            night_hours=resolved.hours_of(CATEGORY_NIGHT),
            holiday_hours=resolved.hours_of(CATEGORY_HOLIDAY),
            weekend_hours=resolved.hours_of(CATEGORY_WEEKEND),
            overtime_hours=totals.overtime_hours,
            underworked_hours=totals.underworked_hours,
            underworked_explained_hours=totals.underworked_explained_hours,
            used_rule_version_id=norm.used_rule_version_id,
            used_conflict_policy_version_id=resolved.used_conflict_policy_version_id,
            legal_base=context.legal_base,
        )
        return CalculationOutcome(breakdown=breakdown, time_zone=context.time_zone)


def _latest_end(facts: CollectedFacts, period_end: date) -> date:
    """Самая поздняя дата, которой касается факт периода.

    Нужна потому, что суточное дежурство, начатое в последний день
    периода, законно заканчивается уже в следующем (Алгоритм И), а
    классифицировать его вторую половину без календарного типа того дня
    невозможно. Брать `period_end` было бы ошибкой ровно на этом, самом
    частом для ФПС, случае.
    """
    if not facts.service_intervals:
        return period_end
    return max(period_end, max(i.end.date() for i in facts.service_intervals))


def _calendar_horizon(*, facts_end: date) -> date:
    """Календарь запрашивается на день дальше последнего факта.

    Ночное окно `night_window(d)` начинается в сутках `d−1`, и
    классификатор перебирает окна до `последние сутки факта + 1`. Сами
    типы дней при этом нужны только за дни, на которые факт приходится, —
    запас в один день покрывает границу полуоткрытого интервала.
    """
    return facts_end + timedelta(days=1)
