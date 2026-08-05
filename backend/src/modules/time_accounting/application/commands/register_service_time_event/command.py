"""`RegisterServiceTimeEventCommand` — TA008-TA012 одной командой.

--- Почему одна команда, а не пять -------------------------------------

Бэклог называет пять отдельных слайсов (`RegisterActualShift`,
`RegisterSickness`, `RegisterSuspension`, `AttractOvertime`,
`RegisterBusinessTrip`), и это разумное деление на уровне ПЛАНА: у них
разные приоритеты (P0-P2) и разные критерии готовности.

Реализованы они одной командой, потому что всё, чем они отличались бы,
уже выражено в другом месте:

* **openapi** описывает ОДИН эндпоинт `POST /timesheets/{id}/events` с
  одной схемой `ServiceTimeEventRequest` и `discriminator: eventType`.
  Пять команд за одним эндпоинтом означали бы диспетчер по типу в
  роутере, то есть ту же развилку, но в слое, который её меньше всего
  должен знать.
* **инварианты** 6.1.1 и 6.1.4 одинаковы для всех пяти типов, а различия
  («привлечение требует приказа», «командировка требует места») — это
  правила о полях, проверенные в `ServiceTimeEvent.__post_init__`, и
  зеркалящие их CHECK-ограничения в БД.

Пять почти одинаковых обработчиков разошлись бы при первой же правке
общего инварианта — и разошлись бы молча, потому что тесты каждого из
них по отдельности продолжали бы проходить.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from src.modules.time_accounting.domain.value_objects import ServiceTimeEventType


class RegisterServiceTimeEventCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    timesheet_id: UUID
    event_type: ServiceTimeEventType
    start_time: datetime
    end_time: datetime
    planned_shift_id: UUID | None = None
    overtime_order_id: UUID | None = None
    business_trip_place: str | None = None
