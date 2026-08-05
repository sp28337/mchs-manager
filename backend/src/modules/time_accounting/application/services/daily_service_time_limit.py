"""TA002 — инвариант 6.1.6: «сумма часов `ActualShiftRecord`, приходящихся
на конкретный `EmployeeId` за сутки, не может физически превышать 24 часа».

--- Почему это не метод агрегата ---------------------------------------

Внутри одного табеля проверять нечего. Инвариант 6.1.1 уже запрещает
пересечения событий, а непересекающиеся интервалы физически не могут дать
за одни календарные сутки больше 24 ч:

    Пересечения попарно непересекающихся интервалов с одним и тем же
    суточным окном сами попарно не пересекаются и целиком лежат внутри
    окна длиной 24 ч, значит их суммарная длительность ≤ 24 ч. ∎

То есть будь эта проверка методом `Timesheet`, она была бы мёртвым кодом:
до неё дело доходило бы только после проверки пересечений, которая уже
отклонила бы всё, что могло бы её нарушить.

Содержание у 6.1.6 появляется ровно там, куда инвариант 6.1.1 не
дотягивается: на стыке ДВУХ табелей одного сотрудника. Суточное дежурство
с 31 марта на 1 апреля лежит в мартовском табеле (Алгоритм И,
`assign_by_start`), а апрельский табель — другой агрегат, и
`excl_service_time_event_no_overlap` (по `timesheet_id`) их не сравнивает.
Поэтому проверка живёт здесь, где виден весь сотрудник, а не один его
табель — точно так же, как `RestPeriodPolicyService` в `scheduling`
живёт вне агрегата, потому что ему нужен соседний график.

--- Про часовой пояс ---------------------------------------------------

Проверка сформулирована через «сутки», а сутки где-то начинаются. Пояс
приходит аргументом МЕТОДА, а не задаётся при сборке сервиса, потому что
он свойство места службы: подразделения ФПС стоят в 11 часовых поясах, и
пояс приходит из `personnel.unit.time_zone` (миграция 0016).

Заметим при этом, что на ВЕРДИКТ пояс здесь повлиять не может. Превысить
24 ч за сутки способен только набор с пересечением (см. утверждение
выше — обратная его сторона), а пересечение от пояса не зависит. Пояс
влияет лишь на то, какие именно сутки будут названы в сообщении об
ошибке. Ровно поэтому в БД тот же инвариант выражен глобальным
`excl_actual_shift_employee_no_overlap` вовсе без пояса (см. п. 1
докстринга миграции 0014): SQL сообщений не пишет, ему нужен только
вердикт.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from src.building_blocks.domain.time_interval import TimeInterval
from src.modules.time_accounting.domain.errors import DailyServiceTimeLimitExceededError

_MINUTES_IN_A_DAY = 24 * 60


class DailyServiceTimeLimitService:
    """Проверяет инвариант 6.1.6 по всем фактическим сменам сотрудника."""

    def ensure_within_daily_limit(
        self,
        *,
        employee_id: UUID,
        candidate: TimeInterval,
        existing_shifts: list[TimeInterval],
        time_zone: ZoneInfo,
    ) -> None:
        """Проверяемая смена передаётся отдельно от уже существующих,
        потому что в момент проверки она ещё не сохранена — исключать её
        из выборки не нужно и, что важнее, нечего (та же ошибка, что была
        допущена и исправлена в `scheduling`: параметр
        `exclude_schedule_id` выбрасывал из проверки как раз те смены,
        ради которых проверка и делалась)."""
        per_day = minutes_per_day([*existing_shifts, candidate], time_zone=time_zone)

        exceeded = sorted(day for day, minutes in per_day.items() if minutes > _MINUTES_IN_A_DAY)
        if not exceeded:
            return

        day = exceeded[0]
        raise DailyServiceTimeLimitExceededError(
            f"фактические смены сотрудника {employee_id} за {day} дают "
            f"{per_day[day] / 60:.2f} ч при физическом пределе 24 ч — значит, какие-то "
            f"две из них пересекаются (Domain Model инвариант 6.1.6)"
        )


def minutes_per_day(
    intervals: list[TimeInterval], *, time_zone: ZoneInfo
) -> dict[date, float]:
    """Раскладывает интервалы по календарным суткам пояса, разрезая те,
    что пересекают полночь: суточное дежурство с 08:00 даёт 16 ч первым
    суткам и 8 ч вторым."""
    per_day: dict[date, float] = defaultdict(float)
    for interval in intervals:
        for day, slice_ in split_by_day(interval, time_zone=time_zone):
            per_day[day] += slice_.duration_minutes()
    return per_day


def split_by_day(
    interval: TimeInterval, *, time_zone: ZoneInfo
) -> list[tuple[date, TimeInterval]]:
    """Пары «календарная дата -> часть интервала, попавшая в эти сутки».

    Функция модуля, а не метод: ровно этим же занимаются Алгоритмы Д и Е
    («на какие календарные даты приходится интервал факта»), и второй
    экземпляр той же арифметики рано или поздно разошёлся бы с первым на
    переходе через полночь.
    """
    local_end = interval.end.astimezone(time_zone)

    pieces: list[tuple[date, TimeInterval]] = []
    day = interval.start.astimezone(time_zone).date()
    while True:
        day_end = midnight(day + timedelta(days=1), time_zone=time_zone)
        piece = interval.intersection(
            TimeInterval(start=midnight(day, time_zone=time_zone), end=day_end)
        )
        if piece is not None:
            pieces.append((day, piece))
        if day_end >= local_end:
            break
        day += timedelta(days=1)
    return pieces


def midnight(day: date, *, time_zone: ZoneInfo) -> datetime:
    """Полночь календарной даты в указанном поясе — точка, в которой
    «дата» превращается в момент времени."""
    return datetime(day.year, day.month, day.day, tzinfo=time_zone)
