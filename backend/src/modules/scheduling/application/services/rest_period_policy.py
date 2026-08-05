"""SD006 — `RestPeriodPolicyService`: минимальный межсменный отдых
(Domain Model инвариант 5.1.2, доменный сервис 10.3).

--- Почему это сервис, а не метод агрегата ------------------------------

Инвариант 5.1.2 требует одновременно двух вещей, которых у `DutySchedule`
нет:

1. **Соседний период.** Отдых нарушается ровно там, где смена последнего
   дня марта соприкасается со сменой первого дня апреля, то есть между
   двумя РАЗНЫМИ агрегатами. Внутри одного агрегата этот случай не виден
   вовсе — Domain Model разд. 5.1 инвариант 2 говорит об этом прямо:
   «поскольку эта проверка может выходить за пределы одного агрегата
   (соседний период), она реализуется доменным сервисом».
2. **Величину нормы отдыха**, которая не константа, а
   `RuleVersion` категории `minimum_rest_period`, действующая **на дату
   смены**. Зашить сюда «не менее 24 часов» значило бы нарушить принцип
   «Rule → Calculation → Employee» и сделать невозможным пересчёт задним
   числом при смене ведомственного акта.

--- Чем этот файл важен за пределами своей задачи -----------------------

Это ПЕРВОЕ место в кодовой базе, где один модуль реально потребляет
контракт другого. До сих пор граница «модуль ходит наружу только через
`Contracts/`» (Architecture разд. 4.2) была декларацией: `legal_rules`
экспортировал `get_effective_rule_version`, но никто его не звал.

Обратите внимание, чего здесь нет: импорта `legal_rules.domain` или
`legal_rules.infrastructure`. Резолвер приходит параметром типа
`EffectiveRuleVersionResolver`, а конкретную реализацию подставляет
вызывающий — обработчик, который и так знает про инфраструктуру. Поэтому
этот сервис тестируется без БД и без `legal_rules` вообще: достаточно
подсунуть функцию, возвращающую нужное число часов.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import date
from uuid import UUID

from src.building_blocks.domain.time_interval import TimeInterval
from src.modules.scheduling.domain.errors import MinimumRestPeriodViolationError

MINIMUM_REST_PERIOD_RULE_CODE = "REST.MINIMUM_BETWEEN_SHIFTS"

# Возвращает минимальный отдых в часах, действующий на указанную дату для
# указанного scope. Инжектируется, чтобы этот модуль не зависел от
# `legal_rules` ничем, кроме формы вызова.
EffectiveRuleVersionResolver = Callable[[date, dict[str, str]], Awaitable[float]]


class RestPeriodPolicyService:
    """Проверяет, что смена не начинается раньше, чем истёк минимальный
    отдых после предыдущей смены того же сотрудника."""

    def __init__(self, resolve_minimum_rest_hours: EffectiveRuleVersionResolver) -> None:
        self._resolve = resolve_minimum_rest_hours

    async def ensure_rest_before(
        self,
        *,
        employee_id: UUID,
        candidate: TimeInterval,
        existing_shifts: list[TimeInterval],
        scope: dict[str, str],
    ) -> None:
        """Проверяет отдых с ОБЕИХ сторон новой смены.

        Смена вставляется не всегда в конец: график может дополняться
        задним числом, и тогда нарушенным окажется отдых перед уже
        существующей более поздней сменой. Проверять только предыдущую
        смену — типичная ошибка, дающая ложное «всё в порядке» ровно в том
        случае, ради которого сервис и написан.

        `existing_shifts` передаёт вызывающий, и он же отвечает за то,
        чтобы туда попали смены соседних периодов — сам сервис в БД не
        ходит (см. докстринг модуля).
        """
        if not existing_shifts:
            return

        minimum_hours = await self._resolve(candidate.start.date(), scope)

        earlier = [s for s in existing_shifts if s.end <= candidate.start]
        later = [s for s in existing_shifts if s.start >= candidate.end]

        if earlier:
            previous = max(earlier, key=lambda s: s.end)
            gap = previous.gap_to(candidate)
            if gap < minimum_hours:
                raise MinimumRestPeriodViolationError(
                    f"между сменой сотрудника {employee_id}, окончившейся {previous.end}, "
                    f"и новой, начинающейся {candidate.start}, всего {gap:.2f} ч "
                    f"при минимуме {minimum_hours:.2f} ч "
                    f"(RuleVersion '{MINIMUM_REST_PERIOD_RULE_CODE}' на {candidate.start.date()})"
                )

        if later:
            following = min(later, key=lambda s: s.start)
            gap = candidate.gap_to(following)
            if gap < minimum_hours:
                raise MinimumRestPeriodViolationError(
                    f"между новой сменой сотрудника {employee_id}, оканчивающейся "
                    f"{candidate.end}, и следующей, начинающейся {following.start}, "
                    f"всего {gap:.2f} ч при минимуме {minimum_hours:.2f} ч"
                )
