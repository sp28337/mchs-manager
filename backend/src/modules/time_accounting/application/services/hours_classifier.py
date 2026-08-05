"""TA020 — Алгоритмы Г, Д, Е: классификация ночных, праздничных и
выходных часов.

Все три выдают «сырые» величины: один и тот же час может попасть сразу в
несколько категорий (ночь с 1 на 2 января — и ночная, и праздничная).
Разрешает это Алгоритм Ж, и именно поэтому здесь возвращаются ИНТЕРВАЛЫ,
а не суммы: «алгоритму нужны исходные интервалы пересечений, а не только
агрегаты» (Алгоритм Ж вход).

--- Алгоритм Г, ночные часы --------------------------------------------

Ночное окно `[d−1 22:00, d 06:00)` — ночь «привязана» к утру следующих
суток, как принято в производственных календарях. Границы — местные
стенные часы подразделения (`personnel.unit.time_zone`, миграция 0016), а
не UTC: ТК РФ ст. 96 определяет ночное время как «с 22 до 6 часов», и это
часы на стене, а не момент по Гринвичу.

Важное к букве закона (ФЗ-141 ст. 54): продолжительность служебного
времени днём и ночью признаётся равной — ночная смена не сокращается.
Этот алгоритм лишь ВЫДЕЛЯЕТ ночные часы как категорию для последующей
компенсации, ничего не вычитая.

--- Алгоритм Д, праздничные часы ---------------------------------------

`pre_holiday` в этой классификации НЕ участвует. Предпраздничный день
влияет только на норму (Алгоритм Б шаг 7, ТК РФ ст. 95 — минус час), а
праздничным не является: работа 30 декабря не оплачивается как работа
1 января. Это разные, невзаимозаменяемые роли одного признака календаря,
и путаница между ними — самая дорогая ошибка, которую здесь можно
сделать.

--- Алгоритм Е, часы в выходной ----------------------------------------

Единственный алгоритм, который документ описывает двумя ветками — для
пятидневки (шаг 1) и для сменного/суточного режима (шаг 2), — но обе
ветки вычисляют ОДНО И ТО ЖЕ: пересечение факта с датами, у которых
`day_type = 'weekend'`. Шаг 2 говорит это прямо: «трактовка сохраняется
единой (по календарю, а не по индивидуальному графику), поскольку именно
так определена компенсируемая категория ведомственным порядком (Приказ
№ 410); личная ротация смен внутри сменного графика — вопрос
планирования, а не отдельная компенсируемая категория».

Поэтому `regime_type` здесь не параметр. Ветвление, обе ветки которого
дают один результат, — это не гибкость, а приглашение к ошибке: первая же
правка одной ветки разошлась бы со второй, и разница проявилась бы только
на сменном составе, то есть на большинстве личного состава ФПС.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from src.building_blocks.domain.time_interval import TimeInterval

HOLIDAY = "holiday"
WEEKEND = "weekend"

NIGHT_STARTS_AT = time(22, 0)
NIGHT_ENDS_AT = time(6, 0)

# Имена категорий совпадают со значениями `legal_rules.HourCategory` — с
# тем, что лежит в `precedence_list` действующей политики. Совпадение не
# случайное: разойдись они, и Алгоритм Ж не нашёл бы ни одной применимой
# категории в списке приоритетов. Импортировать enum сюда нельзя (чужой
# домен, Architecture разд. 4.2), поэтому связь держится строками — и
# проверяется интеграционным тестом, который заводит политику через
# настоящие данные, а не подсовывает список в мок.
CATEGORY_NIGHT = "night"
CATEGORY_HOLIDAY = "holiday"
CATEGORY_WEEKEND = "weekend"


class CalendarGapError(LookupError):
    """Факт приходится на дату, типа которой в календаре нет.

    Отдельная ошибка, а не «считаем день рабочим»: неопубликованный или
    неполный год — это отсутствие нормативного основания, и молчаливое
    умолчание превратило бы пробел в календаре в тихую потерю праздничных
    часов сотрудника. Отображается в 422.
    """


@dataclass(frozen=True, kw_only=True)
class ClassifiedIntervals:
    """«Сырые» интервалы по категориям (Алгоритмы Г, Д, Е).

    Внутри одной категории интервалы не пересекаются — каждый получен
    пересечением факта с непересекающимися окнами. МЕЖДУ категориями
    пересекаются сколько угодно: в этом и состоит задача Алгоритма Ж.
    """

    night: list[TimeInterval]
    holiday: list[TimeInterval]
    weekend: list[TimeInterval]

    def by_category(self) -> dict[str, list[TimeInterval]]:
        return {
            CATEGORY_NIGHT: self.night,
            CATEGORY_HOLIDAY: self.holiday,
            CATEGORY_WEEKEND: self.weekend,
        }


class HoursClassificationService:
    """Domain Model разд. 10.2 (`HoursClassificationService`).

    Чистая функция от интервалов факта, календаря и пояса — ни БД, ни
    сети, и потому инвариант 6.1.5 («повторный расчёт обязан дать
    идентичный результат») здесь выполняется по построению.
    """

    def classify(
        self,
        *,
        service_intervals: list[TimeInterval],
        day_types: Mapping[date, str],
        time_zone: ZoneInfo,
    ) -> ClassifiedIntervals:
        return ClassifiedIntervals(
            night=self._night_intervals(service_intervals, time_zone),
            holiday=self._day_type_intervals(
                service_intervals, day_types, HOLIDAY, time_zone
            ),
            weekend=self._day_type_intervals(
                service_intervals, day_types, WEEKEND, time_zone
            ),
        )

    # ------------------------------------------------------- Алгоритм Г

    def _night_intervals(
        self, service_intervals: list[TimeInterval], time_zone: ZoneInfo
    ) -> list[TimeInterval]:
        pieces: list[TimeInterval] = []
        for fact in service_intervals:
            for window in self._night_windows_touching(fact, time_zone):
                overlap = fact.intersection(window)
                if overlap is not None:
                    pieces.append(overlap)
        return sorted(pieces, key=lambda i: i.start)

    def _night_windows_touching(
        self, fact: TimeInterval, time_zone: ZoneInfo
    ) -> list[TimeInterval]:
        """Ночные окна, способные пересечься с интервалом факта.

        Перебираются даты от суток начала факта до суток его конца ПЛЮС
        ОДНИ: окно `night_window(d)` начинается ещё в сутках `d−1`,
        поэтому смена, кончающаяся 3-го в 01:00, попадает в окно,
        привязанное к 3-му, а смена, начавшаяся 2-го в 23:00, — тоже.
        Без запаса в сутки терялся бы ровно самый частый случай: заступление
        на суточное дежурство вечером.
        """
        first = fact.start.astimezone(time_zone).date()
        last = fact.end.astimezone(time_zone).date()

        windows: list[TimeInterval] = []
        day = first
        while day <= last + timedelta(days=1):
            windows.append(
                TimeInterval(
                    start=datetime.combine(
                        day - timedelta(days=1), NIGHT_STARTS_AT, tzinfo=time_zone
                    ),
                    end=datetime.combine(day, NIGHT_ENDS_AT, tzinfo=time_zone),
                )
            )
            day += timedelta(days=1)
        return windows

    # ---------------------------------------------------- Алгоритмы Д, Е

    def _day_type_intervals(
        self,
        service_intervals: list[TimeInterval],
        day_types: Mapping[date, str],
        wanted: str,
        time_zone: ZoneInfo,
    ) -> list[TimeInterval]:
        pieces: list[TimeInterval] = []
        for fact in service_intervals:
            for day, piece in _split_by_local_day(fact, time_zone):
                day_type = day_types.get(day)
                if day_type is None:
                    raise CalendarGapError(
                        f"в производственном календаре нет дня {day}, на который "
                        f"приходится факт [{fact.start}, {fact.end}); классифицировать "
                        f"его не по чему (Алгоритмы Д/Е шаг 2)"
                    )
                if day_type == wanted:
                    pieces.append(piece)
        return sorted(pieces, key=lambda i: i.start)


def _split_by_local_day(
    interval: TimeInterval, time_zone: ZoneInfo
) -> list[tuple[date, TimeInterval]]:
    """Те же сутки, что и у `daily_service_time_limit.split_by_day`.

    Импортировать оттуда было бы правильнее, но этот модуль — про
    классификацию, а тот — про инвариант 6.1.6; связывать их значило бы
    заявить зависимость, которой нет по смыслу. Общая часть — арифметика
    полуоткрытых интервалов — уже вынесена в `TimeInterval.intersection`,
    и повторяется здесь только цикл по датам.
    """
    local_end = interval.end.astimezone(time_zone)
    pieces: list[tuple[date, TimeInterval]] = []
    day = interval.start.astimezone(time_zone).date()
    while True:
        day_start = datetime.combine(day, time(0, 0), tzinfo=time_zone)
        day_end = datetime.combine(day + timedelta(days=1), time(0, 0), tzinfo=time_zone)
        piece = interval.intersection(TimeInterval(start=day_start, end=day_end))
        if piece is not None:
            pieces.append((day, piece))
        if day_end >= local_end:
            break
        day += timedelta(days=1)
    return pieces
