"""LM003 — write-side репозиторий `LeaveGrant`.

`overlapping` и `has_once_per_service_grant` — не удобные выборки, а
опоры инвариантов 9.1.1 и 9.1.2: оба межагрегатные, оба проверяются
доменным сервисом ДО сохранения (Domain Model разд. 10.4), и оба
дублируются ограничением БД на случай гонки.

Условия выборок повторяют условия ограничений дословно — `status IN
('active','recalled')` у одного, `status <> 'cancelled'` у другого.
Разойдись они, приложение отказывало бы там, где БД разрешает, или
наоборот, и второе хуже: отказ БД приходит транзакцией позже, без
объяснения, которое можно показать кадровику.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import bindparam, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.leave_management.domain.leave_grant import LeaveGrant
from src.modules.leave_management.domain.value_objects import (
    LeavePeriod,
    LeaveStatus,
    LeaveType,
)
from src.modules.leave_management.infrastructure.orm_mapping import leave_grant_table

_CALENDAR_STATUSES = [s.value for s in LeaveStatus if s.occupies_calendar]
_RIGHT_CONSUMING_STATUSES = [
    s.value for s in LeaveStatus if s.consumes_once_per_service_right
]


class LeaveGrantRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, grant_id: UUID) -> LeaveGrant | None:
        return await self._session.get(LeaveGrant, grant_id)

    async def list_for_employee(self, employee_id: UUID) -> list[LeaveGrant]:
        """LM008 — все отпуска сотрудника, новые сверху.

        Отменённые тоже: список отпусков — кадровая история, и скрыть из
        неё ошибочный приказ значило бы сделать вид, что его не издавали.
        """
        result = await self._session.execute(
            select(LeaveGrant)
            .where(leave_grant_table.c.employee_id == employee_id)
            .order_by(leave_grant_table.c.leave_period.desc())
        )
        return list(result.scalars().all())

    async def overlapping(
        self, *, employee_id: UUID, period: LeavePeriod
    ) -> list[LeaveGrant]:
        """Отпуска, занимающие календарь и пересекающиеся с периодом.

        Пересечение считает сама PostgreSQL оператором `&&` по
        `daterange` с границами `[)` — то есть тем же способом, каким
        отказывает `excl_leave_period_no_overlap`. Сравнивать границы
        вручную здесь значило бы завести второе определение пересечения,
        и первое же расхождение с ограничением дало бы отказ БД без
        внятного объяснения.
        """
        result = await self._session.execute(
            select(LeaveGrant).where(
                leave_grant_table.c.employee_id == employee_id,
                leave_grant_table.c.status.in_(_CALENDAR_STATUSES),
                leave_grant_table.c.leave_period.op("&&", is_comparison=True)(
                    bindparam(
                        "candidate_period",
                        period,
                        type_=leave_grant_table.c.leave_period.type,
                    )
                ),
            )
        )
        return list(result.scalars().all())

    async def has_once_per_service_grant(
        self, *, employee_id: UUID, leave_type: LeaveType
    ) -> bool:
        """Инвариант 9.1.2: право, расходуемое навсегда, уже реализовано.

        Отменённые предоставления не считаются — опечатка кадровика не
        должна лишать сотрудника отпуска на всю службу. Зеркало
        `WHERE ... status <> 'cancelled'`.
        """
        existing = await self._session.scalar(
            select(leave_grant_table.c.id)
            .where(
                leave_grant_table.c.employee_id == employee_id,
                leave_grant_table.c.leave_type == leave_type.value,
                leave_grant_table.c.status.in_(_RIGHT_CONSUMING_STATUSES),
            )
            .limit(1)
        )
        return existing is not None

    def add(self, grant: LeaveGrant) -> None:
        self._session.add(grant)
