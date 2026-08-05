"""SC006 — `service_calendar` API router.

Same Presentation-layer rules as the other modules' routers: knows
Application only, takes its DB session from `building_blocks` (never from
`composition/di.py` — see `building_blocks/infrastructure/db.py`), and maps
domain exceptions to the RFC 7807 catalog of API_Conventions разд. 3.

The `423 Locked` mapping is the one this module exercises most: a
published calendar year is immutable, which is exactly what разд. 3 lists
423 for ("Попытка изменить неизменяемый ресурс"), and `openapi.yaml`
declares 423 on both `POST .../days` and (implicitly, via the same rule)
publish.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Path
from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.application.problem import problem_exception
from src.building_blocks.infrastructure.db import get_session
from src.modules.service_calendar.api.schemas import (
    CalendarDayResponse,
    CalendarYearResponse,
    CreateCalendarYearRequest,
    SetCalendarDaysRequest,
)
from src.modules.service_calendar.application.commands.create_calendar_year.command import (
    CreateCalendarYearCommand,
)
from src.modules.service_calendar.application.commands.create_calendar_year.handler import (
    CreateCalendarYearHandler,
)
from src.modules.service_calendar.application.commands.publish_calendar_year.command import (
    PublishCalendarYearCommand,
)
from src.modules.service_calendar.application.commands.publish_calendar_year.handler import (
    PublishCalendarYearHandler,
)
from src.modules.service_calendar.application.commands.set_calendar_days.command import (
    CalendarDayInput,
    SetCalendarDaysCommand,
)
from src.modules.service_calendar.application.commands.set_calendar_days.handler import (
    SetCalendarDaysHandler,
)
from src.modules.service_calendar.application.queries.get_calendar_year.handler import (
    GetCalendarYearHandler,
)
from src.modules.service_calendar.application.queries.get_calendar_year.query import (
    GetCalendarYearQuery,
)
from src.modules.service_calendar.domain.calendar_year import CalendarYear
from src.modules.service_calendar.domain.errors import (
    CalendarYearAlreadyExistsError,
    CalendarYearNotFoundError,
    CalendarYearPublishedError,
    DayOutsideCalendarYearError,
    IncompleteCalendarYearError,
)
from src.modules.service_calendar.infrastructure.repositories import CalendarYearRepository

router = APIRouter()

SessionDep = Annotated[AsyncSession, Depends(get_session)]
IdempotencyKeyDep = Annotated[UUID, Header(alias="Idempotency-Key")]
YearPath = Annotated[int, Path(ge=2000, le=2100)]

_problem = problem_exception


def _to_response(calendar: CalendarYear, *, include_days: bool = True) -> CalendarYearResponse:
    return CalendarYearResponse(
        id=calendar.id,
        year=calendar.year,
        published=calendar.published,
        published_at=calendar.published_at,
        days=(
            [CalendarDayResponse(day=d.day, day_type=d.day_type) for d in calendar.days]
            if include_days
            else []
        ),
    )


@router.post("/years", response_model=CalendarYearResponse, status_code=201)
async def create_calendar_year(
    request: CreateCalendarYearRequest, session: SessionDep, idempotency_key: IdempotencyKeyDep
) -> CalendarYearResponse:
    handler = CreateCalendarYearHandler(session, CalendarYearRepository(session))
    try:
        calendar = await handler.handle(CreateCalendarYearCommand(year=request.year))
    except CalendarYearAlreadyExistsError as exc:
        raise _problem(
            409, "calendar-year-conflict", "Календарь года уже создан", str(exc)
        ) from exc
    return _to_response(calendar)


@router.get("/years/{year}", response_model=CalendarYearResponse)
async def get_calendar_year(year: YearPath, session: SessionDep) -> CalendarYearResponse:
    handler = GetCalendarYearHandler(CalendarYearRepository(session))
    try:
        calendar = await handler.handle(GetCalendarYearQuery(year=year))
    except CalendarYearNotFoundError as exc:
        raise _problem(404, "not-found", "Календарь года не найден", str(exc)) from exc
    return _to_response(calendar)


@router.post("/years/{year}/days", response_model=CalendarYearResponse)
async def set_calendar_days(
    year: YearPath,
    request: SetCalendarDaysRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> CalendarYearResponse:
    handler = SetCalendarDaysHandler(session, CalendarYearRepository(session))
    try:
        calendar = await handler.handle(
            SetCalendarDaysCommand(
                year=year,
                days=[CalendarDayInput(day=d.day, day_type=d.day_type) for d in request.days],
            )
        )
    except CalendarYearNotFoundError as exc:
        raise _problem(404, "not-found", "Календарь года не найден", str(exc)) from exc
    except CalendarYearPublishedError as exc:
        raise _problem(
            423, "immutable-resource", "Календарь года опубликован", str(exc)
        ) from exc
    except DayOutsideCalendarYearError as exc:
        raise _problem(
            422, "domain-invariant-violation", "День не принадлежит этому году", str(exc)
        ) from exc
    return _to_response(calendar)


@router.post("/years/{year}/publish", response_model=CalendarYearResponse)
async def publish_calendar_year(
    year: YearPath, session: SessionDep, idempotency_key: IdempotencyKeyDep
) -> CalendarYearResponse:
    handler = PublishCalendarYearHandler(session, CalendarYearRepository(session))
    try:
        calendar = await handler.handle(PublishCalendarYearCommand(year=year))
    except CalendarYearNotFoundError as exc:
        raise _problem(404, "not-found", "Календарь года не найден", str(exc)) from exc
    except CalendarYearPublishedError as exc:
        raise _problem(
            423, "immutable-resource", "Календарь года уже опубликован", str(exc)
        ) from exc
    except IncompleteCalendarYearError as exc:
        raise _problem(
            422, "domain-invariant-violation", "Календарь года заполнен не полностью", str(exc)
        ) from exc
    return _to_response(calendar)
