"""Обработчик `CreateCompensationCaseCommand` (CO005 + CO006).

Заведение дела и распределение компенсации (Алгоритм К) выполняются
одним действием, хотя агрегат их разделяет. Причина в том, что пустое
дело бесполезно: оно не отвечает ни на один вопрос и не может быть
финализировано (агрегат отвергает пустое). Разделение в агрегате нужно
для другого — чтобы распределение можно было ПОВТОРИТЬ, не заводя дела
заново, когда изменится волеизъявление сотрудника.

Порядок проверок:

1. **Табель утверждён** (инвариант 7.1.1) — «компенсация не может
   опережать факт». Проверяется первым: без утверждённого расчёта
   остальное бессмысленно.
2. **Дела на этот период ещё нет** — зеркало частичного индекса
   `uq_compensation_case_employee_period`. Запросом, а не отловом
   `IntegrityError`, ради внятного тела ответа.
3. **Распределение** — Алгоритм К. Может отказать (нет действующего
   правила для категории), и тогда дело не создаётся вовсе: наполовину
   начисленная компенсация хуже, чем её отсутствие.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.compensation.application.commands.create_compensation_case.command import (
    CreateCompensationCaseCommand,
)
from src.modules.compensation.application.ports import (
    ApprovedPeriodPort,
    CompensationCaseRepositoryPort,
)
from src.modules.compensation.application.services.compensation_allocation import (
    CompensationAllocationService,
)
from src.modules.compensation.domain.compensation_case import CompensationCase
from src.modules.compensation.domain.errors import (
    CaseAlreadyExistsError,
    TimesheetNotApprovedError,
)
from src.modules.compensation.domain.value_objects import (
    AccountingPeriod,
    CompensableHours,
)


class CreateCompensationCaseHandler:
    def __init__(
        self,
        session: AsyncSession,
        repo: CompensationCaseRepositoryPort,
        periods: ApprovedPeriodPort,
        allocation: CompensationAllocationService,
    ) -> None:
        self._session = session
        self._repo = repo
        self._periods = periods
        self._allocation = allocation

    async def handle(self, command: CreateCompensationCaseCommand) -> CompensationCase:
        period = await self._periods.approved_period(
            employee_id=command.employee_id,
            period_start=command.period_start,
            period_end=command.period_end,
        )
        if period is None or not period.is_approved:
            raise TimesheetNotApprovedError(
                f"табель сотрудника {command.employee_id} за период "
                f"[{command.period_start}, {command.period_end}) не утверждён: "
                f"компенсация не может опережать факт "
                f"(Domain Model инвариант 7.1.1)"
            )

        existing = await self._repo.get_active_for_period(
            employee_id=command.employee_id,
            period_start=command.period_start,
            period_end=command.period_end,
        )
        if existing is not None:
            raise CaseAlreadyExistsError(
                f"дело о компенсации за период [{command.period_start}, "
                f"{command.period_end}) уже существует: {existing.id}"
            )

        case = CompensationCase.open_for(
            employee_id=command.employee_id,
            timesheet_id=period.timesheet_id,
            period=AccountingPeriod(start=command.period_start, end=command.period_end),
            compensable=CompensableHours(
                night_hours=period.night_hours,
                holiday_hours=period.holiday_hours,
                weekend_hours=period.weekend_hours,
                overtime_hours=period.overtime_hours,
            ),
        )
        await self._allocation.allocate(case=case, legal_base=period.legal_base)

        self._repo.add(case)
        await self._session.commit()
        return case
