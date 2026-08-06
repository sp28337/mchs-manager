"""LM005 — предоставление отпуска.

DoD: «пересечение с существующим отпуском возвращает 409».

--- Порядок шагов не произволен ---------------------------------------

1. Право (одноразовость, пересечение, конфликт со сменой) —
   `LeaveEligibilityService`.
2. Продолжительность — `EntitlementCalculator`.
3. Создание агрегата.
4. Списание ДДО, если сутки присоединяются.

Проверка права идёт ПЕРВОЙ, потому что чтение правил и вычисление стажа
дороже, чем выборка по индексу, и незачем считать продолжительность
отпуска, который не будет предоставлен.

Списание ДДО идёт ПОСЛЕДНИМ и в той же транзакции: движение баланса
ссылается на `leave_grant_id`, значит предоставление обязано уже
существовать. Отказ на этом шаге (недостаточно суток) откатывает всё —
отпуск с необеспеченным присоединением был бы обещанием дней, которых у
сотрудника нет.

--- Почему списание в одной транзакции с чужим модулем ----------------

`rest_balance` живёт в той же базе, и модульный монолит это позволяет
(Architecture разд. 4.1): границы модулей логические, транзакция общая.
Событийная развязка здесь была бы хуже — присоединение суток к отпуску
происходит в момент издания приказа, и «начислим потом» означало бы
приказ, выданный под остаток, который может не подтвердиться.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.leave_management.application.commands.create_leave_grant.command import (
    CreateLeaveGrantCommand,
)
from src.modules.leave_management.application.ports import (
    LeaveGrantRepositoryPort,
    RestBalanceConsumptionPort,
)
from src.modules.leave_management.application.services.entitlement_calculator import (
    EntitlementCalculator,
    EntitlementRequest,
)
from src.modules.leave_management.application.services.leave_eligibility import (
    LeaveEligibilityService,
)
from src.modules.leave_management.domain.leave_grant import LeaveGrant
from src.modules.leave_management.domain.value_objects import LeavePeriod, LeaveType


class CreateLeaveGrantHandler:
    def __init__(
        self,
        session: AsyncSession,
        repo: LeaveGrantRepositoryPort,
        eligibility: LeaveEligibilityService,
        entitlement: EntitlementCalculator,
        outbox: OutboxWriter,
        rest_balance: RestBalanceConsumptionPort | None = None,
    ) -> None:
        self._session = session
        self._repo = repo
        self._eligibility = eligibility
        self._entitlement = entitlement
        self._outbox = outbox
        self._rest_balance = rest_balance

    async def handle(self, command: CreateLeaveGrantCommand) -> LeaveGrant:
        leave_type = LeaveType(command.leave_type)
        period = LeavePeriod(start=command.period_start, end=command.period_end)

        await self._eligibility.ensure_grantable(
            employee_id=command.employee_id, leave_type=leave_type, period=period
        )

        basis = await self._entitlement.calculate(
            EntitlementRequest(
                employee_id=command.employee_id,
                leave_type=leave_type,
                starts_on=period.start,
            )
        )

        grant = LeaveGrant.grant(
            employee_id=command.employee_id,
            leave_type=leave_type,
            period=period,
            entitlement=basis,
            attached_rest_days=command.attached_rest_days,
        )
        self._repo.add(grant)

        if command.attached_rest_days > Decimal(0):
            if self._rest_balance is None:
                raise RuntimeError(
                    "присоединение суток отдыха запрошено, но списание не "
                    "подключено: приказ, выданный без списания, обещал бы дни, "
                    "которые остались бы на балансе"
                )
            # Дата движения — начало отпуска: сутки расходуются тогда,
            # когда сотрудник начинает их использовать, а не когда издан
            # приказ.
            await self._rest_balance.consume(
                employee_id=command.employee_id,
                days=command.attached_rest_days,
                movement_date=period.start,
                leave_grant_id=grant.id,
            )

        await self._outbox.enqueue(grant)
        await self._session.commit()
        return grant
