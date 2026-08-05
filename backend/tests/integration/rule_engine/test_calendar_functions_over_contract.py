"""RE009 (интеграционная половина) — стык двух половин Алгоритма Б шага 6:
календарь загружается через публичный контракт `service_calendar`, счёт
ведут чистые функции `rule_engine`.

Юнит-тесты (`tests/unit/rule_engine/test_calendar_functions.py`) проверяют
арифметику без БД; здесь проверяется, что данные из контракта имеют ровно
ту форму, которую эти функции ждут — `Mapping[date, str]` со строковыми
значениями `day_type`. Разъехаться эти две стороны могут только молча:
enum на одной стороне и строка на другой дали бы нулевые счётчики без
единой ошибки.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from scripts.seed_calendar_2026 import compute_day_types
from src.composition.settings import get_settings
from src.modules.service_calendar.contracts.get_calendar_days import get_day_types
from src.modules.service_calendar.domain.calendar_year import CalendarYear
from src.modules.service_calendar.domain.value_objects import DayType
from src.modules.service_calendar.infrastructure.orm_mapping import start_mappers
from src.modules.service_calendar.infrastructure.repositories import CalendarYearRepository
from src.rule_engine.function_registry.calendar_functions import calendar_facts, working_days_count

pytestmark = pytest.mark.asyncio

start_mappers()

# Свой год, не пересекающийся ни с seed (2026), ни с годами, которые
# занимает tests/integration/service_calendar (2080-2100).
TEST_YEAR = 2079


async def _db_reachable() -> bool:
    try:
        engine = create_async_engine(get_settings().database_dsn)
        async with engine.connect():
            pass
        await engine.dispose()
        return True
    except (OperationalError, OSError):
        # OSError matters: asyncpg raises a bare ConnectionRefusedError when the
        # port is closed, and SQLAlchemy does not wrap OS-level errors in
        # OperationalError — catching only the latter made this check a no-op
        # in exactly the case it exists for. See tests/integration/conftest.py.
        return False


async def _release_year(year: int) -> None:
    """Опубликованный год намеренно неудаляем обычным путём — снимаем
    триггеры, как это делает набор тестов service_calendar (там же
    объяснено, почему это нужно только в тестах)."""
    engine = create_async_engine(get_settings().database_dsn)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        for stmt in (
            "ALTER TABLE service_calendar.calendar_day "
            "DISABLE TRIGGER trg_calendar_day_frozen_after_publish",
            "ALTER TABLE service_calendar.calendar_year "
            "DISABLE TRIGGER trg_calendar_year_publish_is_one_way",
        ):
            await session.execute(text(stmt))
        await session.execute(
            text("DELETE FROM service_calendar.calendar_year WHERE year = :year"), {"year": year}
        )
        for stmt in (
            "ALTER TABLE service_calendar.calendar_day "
            "ENABLE TRIGGER trg_calendar_day_frozen_after_publish",
            "ALTER TABLE service_calendar.calendar_year "
            "ENABLE TRIGGER trg_calendar_year_publish_is_one_way",
        ):
            await session.execute(text(stmt))
        await session.commit()
    await engine.dispose()


@pytest.fixture
async def published_year():  # type: ignore[misc]
    """Опубликованный календарь `TEST_YEAR`, размеченный по тем же
    статутным правилам, что и seed 2026 (день недели тот же смысл имеет в
    любом году — важна не конкретная дата, а что типы дней настоящие, а не
    выдуманные)."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL not reachable — start it with `make up` first")

    await _release_year(TEST_YEAR)

    engine = create_async_engine(get_settings().database_dsn)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        calendar = CalendarYear.create(year=TEST_YEAR)
        day_types = compute_day_types(TEST_YEAR)
        calendar.set_days(sorted(day_types.items()))
        CalendarYearRepository(session).add(calendar)

        # Дни фиксируются ДО публикации, отдельной транзакцией. Иначе
        # `trg_calendar_day_frozen_after_publish` отклонит их вставку: в
        # одной транзакции строка `calendar_year` уже была бы
        # `published = true` к моменту INSERT'а дней. Так же устроен и
        # рабочий путь — `SetCalendarDaysHandler` и
        # `PublishCalendarYearHandler` это две отдельные команды, каждая
        # со своим commit.
        await session.commit()

        calendar.publish(now=datetime.now(UTC))
        await session.commit()

        yield session, day_types

    await engine.dispose()
    await _release_year(TEST_YEAR)


async def test_contract_output_feeds_the_counters_directly(published_year) -> None:  # type: ignore[no-untyped-def]
    """Форма, а не только числа: контракт отдаёт `Mapping[date, str]`, и
    счётчики принимают её без единого преобразования."""
    session, expected = published_year

    loaded = await get_day_types(
        session, period_start=date(TEST_YEAR, 1, 1), period_end=date(TEST_YEAR, 2, 1)
    )

    assert all(isinstance(k, date) for k in loaded)
    assert all(isinstance(v, str) for v in loaded.values())

    # Значения контракта совпадают со значениями enum'а домена — это то,
    # что молча разъехалось бы при смене одной из сторон.
    assert set(loaded.values()) <= {d.value for d in DayType}

    january = [d for d in expected if d.month == 1]
    assert len(loaded) == len(january)
    for day in january:
        assert loaded[day] == expected[day].value


async def test_counts_over_the_contract_match_counts_over_the_pure_calendar(
    published_year,
) -> None:  # type: ignore[no-untyped-def]
    """Одно и то же число, посчитанное из БД и из чистого кода — если бы
    Data Mapper терял или искажал `day_type`, разошлись бы именно здесь."""
    session, expected = published_year
    start, end = date(TEST_YEAR, 1, 1), date(TEST_YEAR + 1, 1, 1)

    from_db = await get_day_types(session, period_start=start, period_end=end)
    pure = {d: t.value for d, t in expected.items()}

    assert working_days_count(from_db, period_start=start, period_end=end) == working_days_count(
        pure, period_start=start, period_end=end
    )
    assert calendar_facts(from_db, period_start=start, period_end=end) == calendar_facts(
        pure, period_start=start, period_end=end
    )


async def test_a_quarter_spanning_the_year_end_is_refused_not_silently_short(
    published_year,
) -> None:  # type: ignore[no-untyped-def]
    """Учётный период может быть кварталом или годом и легко пересекает
    границу года (Алгоритм И). Контракт обязан отказать, а не отдать
    неполный календарь, из которого счётчик вывел бы заниженную норму."""
    from src.modules.service_calendar.contracts.get_calendar_days import (
        CalendarPeriodUnavailable,
    )

    session, _ = published_year
    with pytest.raises(CalendarPeriodUnavailable):
        await get_day_types(
            session,
            period_start=date(TEST_YEAR, 12, 1),
            period_end=date(TEST_YEAR + 1, 2, 1),
        )


async def test_partial_month_norm_is_proportional(published_year) -> None:  # type: ignore[no-untyped-def]
    """Алгоритм Б шаг 8: сотрудник, отслуживший не весь период, получает
    норму по пересечению занятости с периодом. Здесь — механика этого
    пересечения на реальных данных: норма половины января считается по тем
    же счётчикам, просто на суженном интервале."""
    session, _ = published_year
    month_start, month_end = date(TEST_YEAR, 1, 1), date(TEST_YEAR, 2, 1)
    mid = date(TEST_YEAR, 1, 16)

    full = await get_day_types(session, period_start=month_start, period_end=month_end)

    whole = calendar_facts(full, period_start=month_start, period_end=month_end)
    first_half = calendar_facts(full, period_start=month_start, period_end=mid)
    second_half = calendar_facts(full, period_start=mid, period_end=month_end)

    assert (
        first_half["working_days_count"] + second_half["working_days_count"]
        == whole["working_days_count"]
    )
    assert first_half["calendar_days_count"] == (mid - month_start).days
    assert second_half["calendar_days_count"] == (month_end - mid).days
    assert whole["calendar_days_count"] == (month_end - month_start).days
    assert timedelta(days=int(whole["calendar_days_count"])) == month_end - month_start
