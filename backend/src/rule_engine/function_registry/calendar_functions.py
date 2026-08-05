"""RE008 — календарные функции: `working_days_count`,
`pre_holiday_days_count` и остальные счётчики по типам дней.

Это вход Алгоритма Б шага 6, из которого шаг 7 считает норму периода:

    norm_hours = (weekly_norm_hours / 5) × working_days_count
                 − 1 × pre_holiday_days_count

--- Почему эти функции НЕ добавлены в `FUNCTION_REGISTRY` ---------------

`registry.py` раньше обещал, что RE008 подключается «одной строкой в
`FUNCTION_REGISTRY`». Это оказалось неверно, и обещание исправлено там же.
Причина конкретная: запись реестра — это `Callable[..., float]`,
синхронная и чистая, а walker вычисляет аргументы `FunctionFormula` в
`float` ДО вызова (`interpreter/tree_walker.py`). Календарный счётчик
принимает не числа, а календарь, и календарь берётся из БД. Чтобы сделать
его записью реестра, пришлось бы либо протащить I/O внутрь реестра, либо
передавать функциям контекст — то есть сломать ровно ту чистоту, на
которой держится гарантия детерминированности (Принцип 0.1: «один и тот
же набор входных фактов... всегда даёт один и тот же результат»).

Вместо этого счётчики остаются **чистыми функциями над уже загруженным
календарём**, а их результаты кладутся в `EvaluationContext` как
переменные — ровно так, как их и называет Calculation_Engine
(«working_days_count», «weekly_norm_hours» — это переменные контекста,
а не вызовы функций). Формула ссылается на них через `VariableFormula`.

--- Почему здесь нет импорта `service_calendar` ------------------------

`rule_engine` — сквозной пакет, а не bounded context
(Backend_Architecture разд. 1), и зависимости на модуль у него быть не
должно. Загрузка календаря — работа вызывающего Application-слоя:
он берёт данные через публичный контракт
`service_calendar.contracts.get_calendar_days` и передаёт их сюда.
Разделение проверяется двумя наборами тестов: юнит-тесты гоняют эти
функции без БД вообще, интеграционный — связку «контракт → эти функции».

Сборка контекста для Алгоритма Б появится в
`time_accounting/application/services/norm_calculation.py` (TA017), когда
дойдёт очередь до фазы 7.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date, timedelta

# Значения `day_type`, как их отдаёт контракт `service_calendar` — строки,
# а не enum: контракт намеренно говорит строками, чтобы потребитель не
# импортировал чужой домен.
WORKING = "working"
WEEKEND = "weekend"
HOLIDAY = "holiday"
PRE_HOLIDAY = "pre_holiday"

# Календарь в том виде, в каком его отдаёт
# `service_calendar.contracts.get_day_types()`.
Calendar = Mapping[date, str]


class IncompleteCalendarError(ValueError):
    """В календаре нет типа дня для какой-то даты периода.

    Отдельный тип, а не `KeyError`, потому что это не «ключа нет в
    словаре», а «норма посчитана бы по неполным данным». Молча пропустить
    такой день значит занизить `working_days_count` и, следовательно,
    норму — ошибка, которую ниже по течению уже никто не заметит.
    Контракт `service_calendar` отдаёт только опубликованные (а значит
    полные) годы, так что в рабочем пути это недостижимо; проверка нужна
    на случай, когда календарь собран вручную — например, в тесте.
    """


def _dates_in(period_start: date, period_end: date) -> list[date]:
    """Полуоткрытый `[period_start, period_end)` — та же семантика, что у
    контракта `service_calendar` и у всех интервалов в кодовой базе."""
    if period_end <= period_start:
        raise ValueError("period_end must be strictly after period_start")
    span = (period_end - period_start).days
    return [period_start + timedelta(days=i) for i in range(span)]


def count_by_day_type(
    calendar: Calendar, *, period_start: date, period_end: date, day_type: str
) -> int:
    """Сколько дней указанного типа в `[period_start, period_end)`.

    Требует полного покрытия периода: отсутствующая дата — ошибка, а не
    ноль (см. `IncompleteCalendarError`).
    """
    dates = _dates_in(period_start, period_end)
    missing = [d for d in dates if d not in calendar]
    if missing:
        raise IncompleteCalendarError(
            f"календарь не покрывает {len(missing)} дат(ы) периода "
            f"[{period_start}, {period_end}), первая — {missing[0]}"
        )
    return sum(1 for d in dates if calendar[d] == day_type)


def working_days_count(calendar: Calendar, *, period_start: date, period_end: date) -> int:
    """Алгоритм Б шаг 6 — множитель нормы периода."""
    return count_by_day_type(
        calendar, period_start=period_start, period_end=period_end, day_type=WORKING
    )


def pre_holiday_days_count(calendar: Calendar, *, period_start: date, period_end: date) -> int:
    """Алгоритм Б шаг 6 — каждый такой день укорачивает норму на час
    (ТК РФ ст. 95).

    Считает ТОЛЬКО `pre_holiday`. Алгоритм Д шаг 4 подчёркивает, что
    предпраздничный день не участвует в праздничной классификации: «это
    разные, не взаимозаменяемые роли одного и того же признака календаря».
    """
    return count_by_day_type(
        calendar, period_start=period_start, period_end=period_end, day_type=PRE_HOLIDAY
    )


def holiday_days_count(calendar: Calendar, *, period_start: date, period_end: date) -> int:
    return count_by_day_type(
        calendar, period_start=period_start, period_end=period_end, day_type=HOLIDAY
    )


def weekend_days_count(calendar: Calendar, *, period_start: date, period_end: date) -> int:
    return count_by_day_type(
        calendar, period_start=period_start, period_end=period_end, day_type=WEEKEND
    )


def calendar_facts(calendar: Calendar, *, period_start: date, period_end: date) -> dict[str, float]:
    """Все четыре счётчика разом, в форме, готовой для слияния с
    `EvaluationContext` walker'а.

    Это и есть точка стыковки RE008 с Алгоритмом Б: Application-слой
    загружает календарь через контракт `service_calendar`, зовёт эту
    функцию и кладёт результат в контекст, после чего формула нормы
    ссылается на `working_days_count`/`pre_holiday_days_count` как на
    обычные `VariableFormula`.

    `float`, а не `int`, потому что `EvaluationContext` walker'а работает
    во float — приведение здесь, а не в каждой формуле.
    """
    dates = _dates_in(period_start, period_end)
    missing = [d for d in dates if d not in calendar]
    if missing:
        raise IncompleteCalendarError(
            f"календарь не покрывает {len(missing)} дат(ы) периода "
            f"[{period_start}, {period_end}), первая — {missing[0]}"
        )

    counts = dict.fromkeys((WORKING, WEEKEND, HOLIDAY, PRE_HOLIDAY), 0)
    for d in dates:
        day_type = calendar[d]
        if day_type in counts:
            counts[day_type] += 1

    return {
        "working_days_count": float(counts[WORKING]),
        "weekend_days_count": float(counts[WEEKEND]),
        "holiday_days_count": float(counts[HOLIDAY]),
        "pre_holiday_days_count": float(counts[PRE_HOLIDAY]),
        "calendar_days_count": float(len(dates)),
    }
