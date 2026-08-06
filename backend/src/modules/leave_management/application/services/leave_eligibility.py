"""`LeaveEligibilityService` — Domain Model разд. 10.4.

Три инварианта, которые не помещаются в один агрегат, потому что каждый
требует взгляда за его границу:

* **9.1.1** — период не пересекается с другими отпусками ТОГО ЖЕ
  сотрудника: нужны чужие предоставления;
* **9.1.2** — `personal_circumstances_20y` выдаётся один раз за службу:
  нужна вся история;
* **9.1.4** — период не накрывает утверждённую плановую смену: нужен
  другой bounded context. Эта проверка вынесена в отдельный
  `ScheduleConflictChecker` — единственная, пересекающая границу
  контекста, и прятать её среди внутренних было бы неверно.

--- Почему проверка здесь, если то же самое проверяет БД ---------------

Ограничения БД — последнее слово, а не первое. Они срабатывают на
`flush`, сообщают именем ограничения и не знают, какой именно отпуск
помешал. Кадровику нужно другое: «пересекается с основным отпуском с 1 по
21 марта», и назвать это может только тот, кто эти отпуска читал.

Обратное тоже верно: одной проверки в сервисе мало. Два приказа,
оформленных одновременно, увидят одинаковое «свободно» и оба пройдут —
поэтому `excl_leave_period_no_overlap` и
`uq_leave_personal_circumstances_once` остаются.

--- Почему конфликт со сменой — 409, а не 422 -------------------------

Инвариант 9.1.4 говорит «без предварительной отмены/переноса этой
смены», то есть запрос станет исполнимым, как только смену перенесут.
Это конфликт состояния, а не ошибка ввода: 422 предлагал бы кадровику
исправить заявление, тогда как исправлять нужно график.
"""

from __future__ import annotations

from uuid import UUID

from src.modules.leave_management.application.ports import LeaveGrantRepositoryPort
from src.modules.leave_management.application.services.schedule_conflict_checker import (
    ScheduleConflictChecker,
)
from src.modules.leave_management.domain.errors import (
    LeavePeriodOverlapError,
    OncePerServiceLeaveError,
)
from src.modules.leave_management.domain.value_objects import LeavePeriod, LeaveType


class LeaveEligibilityService:
    def __init__(
        self, grants: LeaveGrantRepositoryPort, schedule: ScheduleConflictChecker
    ) -> None:
        self._grants = grants
        self._schedule = schedule

    async def ensure_grantable(
        self, *, employee_id: UUID, leave_type: LeaveType, period: LeavePeriod
    ) -> None:
        await self._ensure_right_not_spent(employee_id=employee_id, leave_type=leave_type)
        await self._ensure_no_overlap(employee_id=employee_id, period=period)
        await self._schedule.ensure_free(employee_id=employee_id, period=period)

    async def _ensure_right_not_spent(
        self, *, employee_id: UUID, leave_type: LeaveType
    ) -> None:
        if not leave_type.is_once_per_service:
            return
        if await self._grants.has_once_per_service_grant(
            employee_id=employee_id, leave_type=leave_type
        ):
            raise OncePerServiceLeaveError(
                f"отпуск вида {leave_type} сотруднику {employee_id} уже "
                f"предоставлялся: ФЗ-141 ст. 64 ч. 1 п. 2 даёт его один раз за "
                f"весь период службы"
            )

    async def _ensure_no_overlap(self, *, employee_id: UUID, period: LeavePeriod) -> None:
        conflicting = await self._grants.overlapping(
            employee_id=employee_id, period=period
        )
        if not conflicting:
            return

        # Смежность пересечением не является — это проверяет сам
        # `daterange` в запросе, — поэтому сюда попадают только настоящие
        # наложения.
        first = conflicting[0]
        raise LeavePeriodOverlapError(
            f"отпуск [{period.start}, {period.end}) пересекается с уже "
            f"предоставленным {first.leave_type} "
            f"[{first.period.start}, {first.period.end}) "
            f"(Domain Model инвариант 9.1.1; смежные периоды пересечением не "
            f"считаются — присоединение оформляется стыковкой границ)"
        )
