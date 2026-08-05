"""TA017 — Алгоритм Б: расчёт нормы учётного периода.

    norm_hours = (weekly_norm_hours / 5) × working_days_count
                 − 1 × pre_holiday_days_count

Формула шага 7 — стандартная методика производственного календаря.
Единица «−1 час за предпраздничный день» — это ТК РФ ст. 95
(«продолжительность рабочего дня, непосредственно предшествующего
нерабочему праздничному дню, уменьшается на один час»), и потому она
константа кода, а не данные: сокращение на час установлено самим
кодексом, а не ведомственным актом, и версионировать его негде.

`weekly_norm_hours`, наоборот, — данные: 40 для гражданского персонала,
не более 36 для вредных и опасных условий (ТК РФ ст. 92, ФЗ-141 ст. 54).
Величина приходит из `RuleVersion` категории `norm_calculation`,
отобранной по `scope = {legal_base, position_category,
service_condition_category}` на дату НАЧАЛА периода — шаги 2-4.

--- Шаг 8: неполный период ---------------------------------------------

Сотрудник, принятый или уволенный в середине периода, получает норму
только по пересечению своей занятости с периодом. Это не смягчение, а
единственная корректная трактовка: норма — это то, сколько человек ДОЛЖЕН
был отслужить, а до приёма на службу он не должен был ничего.

Пересечение считается по календарным дням, а не пропорцией от общей
нормы: доля дней и доля рабочих дней — разные числа, и в месяце, где
сотрудник уволился перед десятидневными новогодними каникулами, разница
составила бы почти всю норму.

--- Чего этот алгоритм НЕ делает ---------------------------------------

Шаг 9: «для сменного/суточного режима норма не распределяется по дням».
Здесь это выражено тем, что режим вообще не участвует в расчёте — норма
периода одна и та же независимо от того, как внутри него расставлены
смены (суммированный учёт, ФЗ-141 ст. 55). Отдельной ветки «если сменный»
нет и быть не должно.

Шаг 1 (определить категории на дату `period_start`, а не на сегодня)
выполняется НЕ здесь: он требует выборки `service_record_entry`, то есть
исторического запроса к `personnel`, которого его контракт пока не
предоставляет — `get_employee_snapshot` честно объявлен снимком «как
известно сейчас». Пока категории берутся текущие; это расхождение с
шагом 1 зафиксировано в `EmployeeCalculationContextPort` и требует нового
контракта `personnel` (запрос на дату), а не правки этого файла.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

_WORKING_DAY = "working"
_PRE_HOLIDAY = "pre_holiday"

# ТК РФ ст. 95 — см. докстринг модуля.
PRE_HOLIDAY_REDUCTION_HOURS = Decimal(1)

# Пятидневная неделя как база пересчёта недельной нормы в дневную. Не
# «рабочих дней в неделе у этого сотрудника»: производственный календарь
# строится от пятидневки для всех режимов, и суммированный учёт сравнивает
# факт именно с этой нормой (ФЗ-141 ст. 55).
_WORKING_DAYS_PER_WEEK = Decimal(5)

NORM_CALCULATION_RULE_CODE = "NORM.WEEKLY_HOURS"
WEEKLY_NORM_FIELD = "weekly_norm_hours"


@dataclass(frozen=True, kw_only=True)
class NormCalculationResult:
    """Норма вместе с провенансом — Алгоритм Б шаг 10.

    `used_rule_version_id` не «полезное дополнение», а обязательный
    элемент: без него пересчёт задним числом после изменения
    законодательства невозможно отличить от «неправильно посчитанного один
    раз».
    """

    norm_hours: Decimal
    used_rule_version_id: UUID
    working_days_count: int
    pre_holiday_days_count: int
    # Фактический интервал, по которому считалась норма. Совпадает с
    # периодом, если сотрудник числился весь период (шаг 8).
    counted_from: date
    counted_to: date


class NormCalculationService:
    """Domain Model разд. 10.1 (`NormCalculationService`).

    Обе зависимости приходят функциями, а не объектами модулей: сервис не
    импортирует ни `legal_rules`, ни `service_calendar` и потому
    тестируется без БД (тот же приём, что в
    `scheduling.RestPeriodPolicyService`).
    """

    def __init__(
        self,
        resolve_weekly_norm: Callable[[date, dict[str, str]], Awaitable[tuple[Decimal, UUID]]],
        count_days_by_type: Callable[[date, date], Awaitable[dict[str, int]]],
    ) -> None:
        self._resolve_weekly_norm = resolve_weekly_norm
        self._count_days_by_type = count_days_by_type

    async def calculate(
        self,
        *,
        period_start: date,
        period_end: date,
        scope: dict[str, str],
        hired_at: date,
        dismissed_at: date | None = None,
    ) -> NormCalculationResult:
        counted_from = max(period_start, hired_at)
        # `dismissed_at` — дата увольнения, и последний служебный день это
        # она сама, поэтому границей полуоткрытого интервала становится
        # следующий день. Взять `dismissed_at` границей значило бы отнять у
        # человека норму его последнего дня службы, а вместе с ней —
        # признать этот день недоработкой.
        counted_to = period_end
        if dismissed_at is not None:
            counted_to = min(period_end, _next_day(dismissed_at))

        if counted_to <= counted_from:
            # Сотрудник не числился в периоде ни дня: уволен до его начала
            # или принят после конца. Норма нулевая, но версия правила всё
            # равно разрешается — провенанс обязан быть и у нуля, иначе
            # «ноль, потому что не служил» неотличим от «ноль, потому что
            # правило не нашлось».
            weekly_norm, rule_version_id = await self._resolve_weekly_norm(period_start, scope)
            return NormCalculationResult(
                norm_hours=Decimal(0),
                used_rule_version_id=rule_version_id,
                working_days_count=0,
                pre_holiday_days_count=0,
                counted_from=counted_from,
                counted_to=counted_from,
            )

        # Шаги 2-4. Дата — начало ПЕРИОДА, а не начало занятости: норма
        # определяется законодательством, действовавшим на период, а не
        # днём приёма конкретного человека.
        weekly_norm, rule_version_id = await self._resolve_weekly_norm(period_start, scope)

        # Шаги 5-6.
        counts = await self._count_days_by_type(counted_from, counted_to)
        working_days = counts.get(_WORKING_DAY, 0)
        pre_holiday_days = counts.get(_PRE_HOLIDAY, 0)

        # Шаг 7.
        norm = (
            weekly_norm / _WORKING_DAYS_PER_WEEK * working_days
            - PRE_HOLIDAY_REDUCTION_HOURS * pre_holiday_days
        )
        # Норма не бывает отрицательной. Уйти в минус можно только на
        # вырожденных данных (период из одних предпраздничных дней при
        # нулевой недельной норме), но записать отрицательную норму
        # означало бы объявить, что сотрудник должен системе часы.
        norm = max(norm, Decimal(0))

        return NormCalculationResult(
            norm_hours=_round_hours(norm),
            used_rule_version_id=rule_version_id,
            working_days_count=working_days,
            pre_holiday_days_count=pre_holiday_days,
            counted_from=counted_from,
            counted_to=counted_to,
        )


def _next_day(day: date) -> date:
    return day + timedelta(days=1)


def _round_hours(value: Decimal) -> Decimal:
    """До сотых — как `numeric(8,2)` в проекции.

    Округление ровно одно и в самом конце: промежуточные округления в
    расчёте, где часы потом станут деньгами, накапливают ошибку в чью-то
    пользу без всякого основания.
    """
    return value.quantize(Decimal("0.01"))
