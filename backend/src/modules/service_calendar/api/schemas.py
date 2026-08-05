"""SC006 — API-layer schemas, mirroring `openapi.yaml`'s ServiceCalendar
DTOs (Backend_Architecture разд. 6.1).

ONE ADDITIVE DEVIATION, stated rather than slipped in: `openapi.yaml`'s
`CalendarYear` schema is `{id, year, published}` with no days, but SC005's
DoD requires "Запрос возвращает полный список дней с типами", and a
calendar year without its days is not much of an answer to
`GET /service-calendar/years/{year}`. `CalendarYearResponse` therefore
carries an extra `days` array.

This is a permitted change, not a contract break: API_Conventions разд. 1's
change policy lists "Добавление необязательного поля в ответ" as NOT
requiring a new version. Existing clients that ignore the field are
unaffected. The reference `openapi.yaml` should gain the field on its next
revision — flagged here because the contract is maintained by hand, ahead
of the code, and this file is where the divergence starts.
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from src.modules.service_calendar.domain.value_objects import DayType


class CreateCalendarYearRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    year: int = Field(ge=2000, le=2100)


class CalendarDayResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    day: date
    day_type: DayType = Field(alias="dayType")


class CalendarYearResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    year: int
    published: bool
    published_at: datetime | None = Field(default=None, alias="publishedAt")
    # See the module docstring: additive, permitted by API_Conventions разд. 1.
    days: list[CalendarDayResponse] = Field(default_factory=list)


class CalendarDayInputSchema(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    day: date
    day_type: DayType = Field(alias="dayType")


class SetCalendarDaysRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    days: list[CalendarDayInputSchema] = Field(min_length=1, max_length=366)
