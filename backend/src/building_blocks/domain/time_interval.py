"""`TimeInterval` — общий для всех модулей VO {начало, конец}.

--- Почему он в building_blocks, а не в модуле ------------------------

Он родился в `scheduling` (SD001) и до появления `time_accounting` жил
там. Держать вторую копию в каждом модуле было бы обычным дублированием,
и в большинстве случаев это меньшее зло, чем общее ядро: два контекста
имеют право понимать похожее понятие по-разному, и Shared Kernel эту
свободу отнимает.

Здесь случай ровно обратный — расхождение было бы не эволюцией, а
дефектом:

`TimeInterval` в каждом модуле ложится в `tstzrange` с границами `'[)'`,
и по этой же колонке работают `EXCLUDE`-ограничения
(`excl_planned_shift_no_overlap`, `excl_service_time_event_no_overlap`,
`excl_actual_shift_employee_no_overlap`). Ответ на вопрос «пересекаются
ли смена, кончающаяся в 08:00, и смена, начинающаяся в 08:00» обязан
совпадать в трёх местах: в домене, в маппинге и в SQL. Разойдись он
между `scheduling` и `time_accounting` — и один и тот же факт получил бы
два разных вердикта в зависимости от того, какой модуль спросили, причём
вылезло бы это ровно на суточных дежурствах, то есть на самом частом
режиме ФПС.

Иначе говоря: тут не «два контекста согласились использовать одинаковый
тип», а «физическое время одно на всех». Такое место — законная причина
для Shared Kernel, в отличие от, например, `AccountingPeriod`, который у
каждого модуля свой: он тянет за собой перечисление типов периода этого
модуля и раскладку его колонок.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from src.building_blocks.domain.value_object import ValueObject


@dataclass(frozen=True, kw_only=True)
class TimeInterval(ValueObject):
    """{начало, конец}; инвариант VO: начало строго раньше конца.

    Полуоткрытый `[start, end)` — как `tstzrange(..., '[)')` в БД. Смена,
    кончающаяся в 08:00, и смена, начинающаяся в 08:00, не пересекаются:
    это пересменка, а не наложение.
    """

    start: datetime
    end: datetime

    def __post_init__(self) -> None:
        if self.end <= self.start:
            raise ValueError(f"начало {self.start} должно быть строго раньше конца {self.end}")
        if self.start.tzinfo is None or self.end.tzinfo is None:
            # tstzrange хранит момент времени, а не «стенные часы». Наивный
            # datetime здесь молча получил бы таймзону сервера — и смена,
            # заведённая в Калининграде и на Камчатке, оказалась бы в одном
            # и том же моменте.
            raise ValueError("границы интервала должны быть с таймзоной (aware datetime)")

    def overlaps(self, other: TimeInterval) -> bool:
        return self.start < other.end and other.start < self.end

    def duration_hours(self) -> float:
        return (self.end - self.start).total_seconds() / 3600

    def duration_minutes(self) -> float:
        """Алгоритм В шаг 5 считает факт в минутах и переводит в часы
        только в самом конце (Алгоритм З шаг 1) — округление на каждом
        промежуточном шаге накапливало бы ошибку в пользу или против
        сотрудника без всякого основания."""
        return (self.end - self.start).total_seconds() / 60

    def gap_to(self, later: TimeInterval) -> float:
        """Часы между концом этого интервала и началом следующего.
        Отрицательное значение означает пересечение — используется
        `RestPeriodPolicyService` (SD006) для проверки минимального
        межсменного отдыха."""
        return (later.start - self.end).total_seconds() / 3600

    def intersection(self, other: TimeInterval) -> TimeInterval | None:
        """Пересечение двух интервалов или `None`, если его нет.

        Аналог оператора `*` над `tstzrange`, которым Алгоритмы Г-Е
        описаны дословно. `None`, а не пустой интервал: пустой
        `TimeInterval` непредставим по инварианту VO, и это правильно —
        «пересечения нет» и «пересечение длиной ноль» здесь одно и то же,
        а два способа сказать одно и то же в расчёте компенсации рано или
        поздно разойдутся.
        """
        start = max(self.start, other.start)
        end = min(self.end, other.end)
        if end <= start:
            return None
        return TimeInterval(start=start, end=end)
