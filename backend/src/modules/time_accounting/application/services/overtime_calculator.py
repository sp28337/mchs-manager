"""TA024 — Алгоритм З: расчёт переработки и недоработки.

Последний шаг пайплайна и самый короткий: вся сложность уже позади, здесь
остаётся сравнить две суммы.

    overtime_hours            = max(0, actual − norm)
    raw_shortfall_hours       = max(0, norm − actual)
    underworked_explained     = min(raw_shortfall, explained)
    underworked_hours         = raw_shortfall

--- Почему `underworked_hours` — это ВСЯ недоработка --------------------

Документ (шаг 6) пишет `underworked_hours = raw_shortfall_hours −
underworked_explained_hours`, то есть называет `underworked_hours`
необъяснённым остатком. Здесь `underworked_hours` — вся недоработка, а
остаток отдан свойством `underworked_unexplained_hours`.

Это не спор с алгоритмом, а согласование его с местом, куда результат
кладётся. Шаг 7 того же алгоритма требует записать в проекцию «суммарный
`underworked_hours` **с разбивкой** на explained/unexplained», то есть
СУММУ и её часть. Если бы `underworked_hours` был остатком, сумма нигде
бы не хранилась и «суммарный» из шага 7 стало бы неоткуда взять, а
`ck_hours_breakdown_explained_within_shortfall` (миграция 0015) —
проверять нечего.

Величины при этом те же самые, просто названы согласованно:
целое + часть + остаток, где остаток вычисляем.

--- Что означает необъяснённый остаток ----------------------------------

Шаг 6: «если он больше нуля, это сигнал для проверки корректности учёта
(ошибка данных, несогласованный график), а НЕ автоматическое финансовое
последствие». Поэтому здесь нет и не должно быть ничего, кроме
вычисления: никаких удержаний, уведомлений или пометок «нарушитель».
Недоработка в суммированном учёте (ФЗ-141 ст. 55) чаще всего означает,
что график составлен с недобором часов, — вопрос к составителю графика,
а не к сотруднику.

--- Взаимоисключение ---------------------------------------------------

Переработка и недоработка — разные знаки одной разности, поэтому
одновременно положительными быть не могут. Это проверяется трижды: здесь
(по построению), в `HoursBreakdown.__post_init__` и
`ck_hours_breakdown_overtime_xor_shortfall` в БД. Троекратность
намеренная — величина уходит в компенсацию, то есть в деньги.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

_MINUTES_PER_HOUR = Decimal(60)


@dataclass(frozen=True, kw_only=True)
class OvertimeResult:
    overtime_hours: Decimal
    underworked_hours: Decimal
    underworked_explained_hours: Decimal
    actual_hours: Decimal

    @property
    def underworked_unexplained_hours(self) -> Decimal:
        """Алгоритм З шаг 6 — необъяснённый остаток."""
        return self.underworked_hours - self.underworked_explained_hours


class OvertimeCalculationService:
    """Чистая функция: те же входы дают тот же результат (инвариант
    6.1.5)."""

    def calculate(
        self,
        *,
        norm_hours: Decimal,
        actual_minutes_total: float,
        explained_absence_minutes: float,
    ) -> OvertimeResult:
        actual_hours = _hours(actual_minutes_total)
        explained_hours = _hours(explained_absence_minutes)

        overtime = max(Decimal(0), actual_hours - norm_hours)
        shortfall = max(Decimal(0), norm_hours - actual_hours)
        # Объяснить можно только то, что есть: больничный длиннее
        # недоработки не превращает её в переработку и не уходит в минус.
        explained = min(shortfall, explained_hours)

        return OvertimeResult(
            overtime_hours=overtime,
            underworked_hours=shortfall,
            underworked_explained_hours=explained,
            actual_hours=actual_hours,
        )


def _hours(minutes: float) -> Decimal:
    return (Decimal(str(minutes)) / _MINUTES_PER_HOUR).quantize(Decimal("0.01"))
