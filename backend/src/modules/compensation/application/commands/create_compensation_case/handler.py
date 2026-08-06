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
    EmployeeUnitPort,
)
from src.modules.compensation.application.services.compensable_hours_policy import (
    CompensableHoursPolicy,
)
from src.modules.compensation.application.services.compensation_allocation import (
    CompensationAllocationService,
)
from src.modules.compensation.domain.compensation_case import CompensationCase
from src.modules.compensation.domain.errors import (
    CaseAlreadyExistsError,
    NothingToCompensateError,
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
        units: EmployeeUnitPort,
    ) -> None:
        self._session = session
        self._repo = repo
        self._periods = periods
        self._allocation = allocation
        self._units = units
        self._policy = CompensableHoursPolicy()

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

        # Подразделение НА НАЧАЛО периода, а не текущее (миграция 0019):
        # затраты марта принадлежат мартовской части.
        unit_id = await self._units.unit_at(
            employee_id=command.employee_id, as_of=command.period_start
        )
        if unit_id is None:
            raise TimesheetNotApprovedError(
                f"подразделение сотрудника {command.employee_id} на "
                f"{command.period_start} неизвестно: отнести затраты не к чему"
            )

        # Приказ № 410 пп. 13-14: не всякий зафиксированный час подлежит
        # компенсации. У сменного состава ночные, праздничные и выходные
        # часы в пределах нормы не компенсируются вовсе — это характер их
        # службы, а не привлечение сверх неё.
        compensable = self._policy.compensable(
            breakdown=CompensableHours(
                night_hours=period.night_hours,
                holiday_hours=period.holiday_hours,
                weekend_hours=period.weekend_hours,
                overtime_hours=period.overtime_hours,
            ),
            regime_type=period.regime_type,
        )
        if not compensable.non_empty_categories():
            raise NothingToCompensateError(
                f"за период [{command.period_start}, {command.period_end}) сотруднику "
                f"{command.employee_id} компенсировать нечего: режим "
                f"{period.regime_type}, Приказ МЧС России № 410 пп. 13-14"
            )

        case = CompensationCase.open_for(
            employee_id=command.employee_id,
            timesheet_id=period.timesheet_id,
            unit_id=unit_id,
            period=AccountingPeriod(start=command.period_start, end=command.period_end),
            compensable=compensable,
        )
        await self._allocation.allocate(case=case, legal_base=period.legal_base)

        self._repo.add(case)
        await self._session.commit()
        return case
