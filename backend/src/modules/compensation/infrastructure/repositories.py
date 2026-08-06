"""CO003 — write-side репозиторий `CompensationCase`.

Две операции получения, и разница между ними не техническая.

`get` отдаёт дело как оно лежит в БД — без `compensable`. Этого достаточно
для чтения, записи волеизъявления и финализации: ни одна из этих операций
не добавляет часов, а значит инвариант 7.1.2 нарушить не может.

`get_with_limits` дополнительно восстанавливает предел из контракта
`time_accounting`. Он нужен ровно там, где строки добавляются, — и
получить его иначе, чем спросив у владельца факта, нельзя: собственной
копии у этого модуля нет и быть не должно (см. докстринг `orm_mapping`).
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.compensation.domain.compensation_case import CompensationCase
from src.modules.compensation.domain.value_objects import CompensableHours
from src.modules.compensation.infrastructure.orm_mapping import compensation_case_table
from src.modules.time_accounting.contracts.get_approved_breakdown import (
    ApprovedBreakdownNotFound,
    get_approved_breakdown,
)


class CompensationCaseRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, case_id: UUID) -> CompensationCase | None:
        return await self._session.get(CompensationCase, case_id)

    async def get_with_limits(self, case_id: UUID) -> CompensationCase | None:
        """Дело вместе с восстановленным пределом компенсации.

        Если утверждённого расчёта больше нет (табель переоткрыли), предел
        остаётся `None`, и агрегат откажет в добавлении строк сам. Это
        верное поведение: начислять по расчёту, который перестал быть
        окончательным, нельзя, а тихо взять прежние числа значило бы
        сделать вид, что переоткрытия не было.
        """
        case = await self.get(case_id)
        if case is None:
            return None

        try:
            breakdown = await get_approved_breakdown(
                self._session,
                employee_id=case.employee_id,
                period_start=case.period.start,
                period_end=case.period.end,
            )
        except ApprovedBreakdownNotFound:
            return case

        if breakdown.is_approved:
            case.compensable = CompensableHours(
                night_hours=breakdown.night_hours,
                holiday_hours=breakdown.holiday_hours,
                weekend_hours=breakdown.weekend_hours,
                overtime_hours=breakdown.overtime_hours,
            )
        return case

    async def get_active_for_period(
        self, *, employee_id: UUID, period_start: date, period_end: date
    ) -> CompensationCase | None:
        """Действующее (не корректирующее) дело на пару «сотрудник +
        период» — то же условие, что у частичного индекса
        `uq_compensation_case_employee_period`."""
        result = await self._session.execute(
            select(CompensationCase).where(
                compensation_case_table.c.employee_id == employee_id,
                compensation_case_table.c.period_start == period_start,
                compensation_case_table.c.period_end == period_end,
                compensation_case_table.c.corrects_case_id.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def list_for_employee(
        self, *, employee_id: UUID, page: int = 1, page_size: int = 20
    ) -> list[CompensationCase]:
        """CO012 — история дел сотрудника, новые сверху."""
        result = await self._session.execute(
            select(CompensationCase)
            .where(compensation_case_table.c.employee_id == employee_id)
            .order_by(compensation_case_table.c.period_start.desc())
            .limit(page_size)
            .offset((page - 1) * page_size)
        )
        return list(result.scalars().all())

    def add(self, case: CompensationCase) -> None:
        self._session.add(case)
