"""SC007 — integration tests for `service_calendar` against a REAL
PostgreSQL: HTTP-level publish flow, the DB-side immutability guarantees,
and the public Contract that the calculation engine will read.

Skips when Postgres is unreachable, like every other integration test here.
"""

from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.testclient import TestClient

from src.composition.settings import get_settings
from src.modules.service_calendar.contracts.get_calendar_days import (
    CalendarPeriodUnavailable,
    count_days_by_type,
    get_day_types,
)
from src.modules.service_calendar.domain.value_objects import days_in_year
from src.modules.service_calendar.infrastructure.orm_mapping import start_mappers

pytestmark = pytest.mark.asyncio

BASE = "/api/v1/service-calendar"

start_mappers()

# Years come from the far end of the allowed range (`ck_calendar_year_range`
# permits 2000-2100), well clear of the dev seed, which owns 2026. 2096 is
# reserved for the leap-year test and excluded from the pool.
LEAP_YEAR = 2096
_YEAR_POOL = iter(y for y in range(2080, 2101) if y != LEAP_YEAR)


async def _release_year(year: int) -> None:
    """Force-delete a calendar year and its days, trigger guards and all.

    Needed because these tests run against a PERSISTENT database in local
    development (CI gets a fresh one), and a published year is deliberately
    undeletable through every normal path — that is the whole point of
    migration 0009's triggers. Without this, the suite would pass once and
    then fail on `uq_calendar_year` for every run afterwards, which is a
    worse failure than the one the triggers prevent: it looks like a
    regression and isn't.

    Disabling a trigger requires table ownership, which the test role has
    and no application role should.
    """
    engine = create_async_engine(get_settings().database_dsn)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as cleanup_session:
        await cleanup_session.execute(
            text(
                "ALTER TABLE service_calendar.calendar_day "
                "DISABLE TRIGGER trg_calendar_day_frozen_after_publish"
            )
        )
        await cleanup_session.execute(
            text(
                "ALTER TABLE service_calendar.calendar_year "
                "DISABLE TRIGGER trg_calendar_year_publish_is_one_way"
            )
        )
        await cleanup_session.execute(
            text("DELETE FROM service_calendar.calendar_year WHERE year = :year"),
            {"year": year},
        )
        await cleanup_session.execute(
            text(
                "ALTER TABLE service_calendar.calendar_day "
                "ENABLE TRIGGER trg_calendar_day_frozen_after_publish"
            )
        )
        await cleanup_session.execute(
            text(
                "ALTER TABLE service_calendar.calendar_year "
                "ENABLE TRIGGER trg_calendar_year_publish_is_one_way"
            )
        )
        await cleanup_session.commit()
    await engine.dispose()


@pytest.fixture
async def year():  # type: ignore[misc]
    """A calendar year this test owns exclusively, guaranteed absent from
    the DB at the start and removed again afterwards."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL not reachable — start it with `make up` first")

    allocated = next(_YEAR_POOL)
    await _release_year(allocated)
    yield allocated
    await _release_year(allocated)


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


@pytest.fixture
async def client():  # type: ignore[misc]
    if not await _db_reachable():
        pytest.skip("PostgreSQL not reachable — start it with `make up` first")

    from src.composition.api_app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
async def session():  # type: ignore[misc]
    if not await _db_reachable():
        pytest.skip("PostgreSQL not reachable — start it with `make up` first")

    engine = create_async_engine(get_settings().database_dsn)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db_session:
        yield db_session
    await engine.dispose()


def _idem() -> dict[str, str]:
    return {"Idempotency-Key": str(uuid4())}


def _every_day(year: int) -> list[dict[str, str]]:
    """A whole year of `working` days — enough to satisfy the completeness
    invariant; the specific types are what individual tests override."""
    start = date(year, 1, 1)
    return [
        {"day": (start + timedelta(days=i)).isoformat(), "dayType": "working"}
        for i in range(days_in_year(year))
    ]


def _create_year(client: TestClient, year: int) -> dict:  # type: ignore[type-arg]
    resp = client.post(f"{BASE}/years", json={"year": year}, headers=_idem())
    assert resp.status_code == 201, resp.text
    return resp.json()


def _fill(client: TestClient, year: int, days: list[dict[str, str]] | None = None) -> None:
    resp = client.post(
        f"{BASE}/years/{year}/days", json={"days": days or _every_day(year)}, headers=_idem()
    )
    assert resp.status_code == 200, resp.text


def _publish(client: TestClient, year: int) -> dict:  # type: ignore[type-arg]
    resp = client.post(f"{BASE}/years/{year}/publish", headers=_idem())
    assert resp.status_code == 200, resp.text
    return resp.json()


# ------------------------------------------------------------ HTTP flow


async def test_create_fill_publish_flow(client: TestClient, year: int) -> None:
    created = _create_year(client, year)
    assert created["published"] is False

    _fill(client, year)

    fetched = client.get(f"{BASE}/years/{year}")
    assert fetched.status_code == 200, fetched.text
    body = fetched.json()
    # SC005's DoD: the year comes back with its full list of days.
    assert len(body["days"]) == days_in_year(year)
    assert body["days"][0]["day"] == date(year, 1, 1).isoformat()

    published = _publish(client, year)
    assert published["published"] is True
    assert published["publishedAt"] is not None


async def test_a_leap_year_takes_all_366_days(client: TestClient) -> None:
    """DB012's DoD: "Вставка 366 дней для високосного года проходит без
    ошибок". 2096 is a leap year (divisible by 4, not a century)."""
    year = LEAP_YEAR
    await _release_year(year)
    assert days_in_year(year) == 366
    _create_year(client, year)
    _fill(client, year)

    body = client.get(f"{BASE}/years/{year}").json()
    assert len(body["days"]) == 366


async def test_publishing_an_incomplete_year_is_rejected(
    client: TestClient, year: int
) -> None:
    _create_year(client, year)
    _fill(client, year, days=_every_day(year)[:-1])

    resp = client.post(f"{BASE}/years/{year}/publish", headers=_idem())
    assert resp.status_code == 422, resp.text
    assert "missing" in resp.json()["detail"]["detail"]


async def test_editing_a_published_year_is_locked(client: TestClient, year: int) -> None:
    """SC007's own DoD: "Тест подтверждает отказ при попытке правки после
    publish" — 423 Locked per API_Conventions разд. 3."""
    _create_year(client, year)
    _fill(client, year)
    _publish(client, year)

    resp = client.post(
        f"{BASE}/years/{year}/days",
        json={"days": [{"day": date(year, 5, 1).isoformat(), "dayType": "holiday"}]},
        headers=_idem(),
    )
    assert resp.status_code == 423, resp.text


async def test_a_day_outside_the_year_is_rejected(client: TestClient, year: int) -> None:
    _create_year(client, year)

    resp = client.post(
        f"{BASE}/years/{year}/days",
        json={"days": [{"day": date(year + 1, 1, 1).isoformat(), "dayType": "working"}]},
        headers=_idem(),
    )
    assert resp.status_code == 422, resp.text


async def test_duplicate_year_is_a_conflict(client: TestClient, year: int) -> None:
    _create_year(client, year)
    resp = client.post(f"{BASE}/years", json={"year": year}, headers=_idem())
    assert resp.status_code == 409, resp.text


# ------------------------------------------------- DB-level guarantees


async def test_published_calendar_is_frozen_at_the_database_level(
    client: TestClient, session, year: int
) -> None:  # type: ignore[no-untyped-def]
    """The trigger, not the aggregate — this is what still holds when
    something bypasses the domain (migration 0009's third guarantee)."""
    _create_year(client, year)
    _fill(client, year)
    _publish(client, year)

    with pytest.raises(IntegrityError) as exc_info:
        await session.execute(
            text(
                "UPDATE service_calendar.calendar_day SET day_type = 'holiday' "
                "WHERE year = :year AND day = :day"
            ),
            {"year": year, "day": date(year, 6, 1)},
        )
    assert "immutable" in str(exc_info.value)
    await session.rollback()


async def test_a_published_year_cannot_be_un_published_at_the_database_level(
    client: TestClient, session, year: int
) -> None:  # type: ignore[no-untyped-def]
    _create_year(client, year)
    _fill(client, year)
    _publish(client, year)

    with pytest.raises(IntegrityError) as exc_info:
        await session.execute(
            text(
                "UPDATE service_calendar.calendar_year "
                "SET published = false, published_at = NULL WHERE year = :year"
            ),
            {"year": year},
        )
    assert "un-published" in str(exc_info.value)
    await session.rollback()


# ------------------------------------------------------------- Contract


async def test_contract_counts_days_by_type_for_the_norm_calculation(
    client: TestClient, session, year: int
) -> None:  # type: ignore[no-untyped-def]
    """The exact input of Алгоритм Б шаг 6."""
    _create_year(client, year)

    days = _every_day(year)
    # Make January 1-3 non-working: holiday, holiday, weekend; and make
    # 31 December a pre-holiday.
    days[0]["dayType"] = "holiday"
    days[1]["dayType"] = "holiday"
    days[2]["dayType"] = "weekend"
    days[-1]["dayType"] = "pre_holiday"
    _fill(client, year, days=days)
    _publish(client, year)

    counts = await count_days_by_type(
        session, period_start=date(year, 1, 1), period_end=date(year + 1, 1, 1)
    )
    assert counts["holiday"] == 2
    assert counts["weekend"] == 1
    assert counts["pre_holiday"] == 1
    assert counts["working"] == days_in_year(year) - 4
    assert sum(counts.values()) == days_in_year(year)


async def test_contract_period_is_half_open(client: TestClient, session, year: int) -> None:  # type: ignore[no-untyped-def]
    _create_year(client, year)
    _fill(client, year)
    _publish(client, year)

    counts = await count_days_by_type(
        session, period_start=date(year, 1, 1), period_end=date(year, 1, 8)
    )
    assert sum(counts.values()) == 7, "[1 Jan, 8 Jan) is seven days, not eight"


async def test_contract_returns_day_types_keyed_by_date(
    client: TestClient, session, year: int
) -> None:  # type: ignore[no-untyped-def]
    """The lookup shape Алгоритмы Д/Е use."""
    _create_year(client, year)
    days = _every_day(year)
    days[0]["dayType"] = "holiday"
    _fill(client, year, days=days)
    _publish(client, year)

    types = await get_day_types(
        session, period_start=date(year, 1, 1), period_end=date(year, 1, 5)
    )
    assert types[date(year, 1, 1)] == "holiday"
    assert types[date(year, 1, 2)] == "working"
    assert len(types) == 4


async def test_contract_refuses_an_unpublished_period(
    client: TestClient, session, year: int
) -> None:  # type: ignore[no-untyped-def]
    """A draft calendar must not reach a norm calculation: it would produce
    a wrong norm that nothing downstream could detect."""
    _create_year(client, year)
    _fill(client, year)  # filled but NOT published

    with pytest.raises(CalendarPeriodUnavailable):
        await count_days_by_type(
            session, period_start=date(year, 1, 1), period_end=date(year, 2, 1)
        )


async def test_contract_refuses_a_period_spanning_an_unpublished_year(
    client: TestClient, session, year: int
) -> None:  # type: ignore[no-untyped-def]
    """A quarter or year period routinely straddles a year boundary — a
    partial answer there would silently under-count."""
    await _release_year(year + 1)
    _create_year(client, year)
    _fill(client, year)
    _publish(client, year)

    with pytest.raises(CalendarPeriodUnavailable, match=str(year + 1)):
        await count_days_by_type(
            session, period_start=date(year, 12, 1), period_end=date(year + 1, 2, 1)
        )
