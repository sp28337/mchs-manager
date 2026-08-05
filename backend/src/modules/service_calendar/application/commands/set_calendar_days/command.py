"""`SetCalendarDaysCommand` — SC003. Mirrors `openapi.yaml`
`SetCalendarDaysRequest` plus the `{year}` path parameter."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict, Field

from src.modules.service_calendar.domain.value_objects import DayType


class CalendarDayInput(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    day: date
    day_type: DayType


class SetCalendarDaysCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    year: int = Field(ge=2000, le=2100)
    # 1..366 mirrors `openapi.yaml`'s `minItems`/`maxItems`: a whole leap
    # year in one call is the intended maximum (SC003's DoD: "Массовая
    # установка 366 дней проходит одной транзакцией").
    days: list[CalendarDayInput] = Field(min_length=1, max_length=366)
