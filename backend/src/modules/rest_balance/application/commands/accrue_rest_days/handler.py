"""RB004 — Алгоритм Л, начисление ДДО.

Срабатывает по факту финализации `CompensationCase`, а не по прямому
запросу: инвариант 8.1.2 — «начисление ДДО не может возникнуть из
воздуха, вне процесса компенсации».

--- Перевод часов в сутки ----------------------------------------------

Алгоритм Л требует переводить `hours_amount` в `amount_days` «по правилу,
заданному активной `rule_version` категории `compensation_coefficient`»,
и добавляет, что точное значение подлежит верификации (открытый вопрос
SRS 9.3.1). Поэтому коэффициент здесь не константа, а порт: подставляется
`legal_rules`, и меняется он публикацией версии правила, а не
развёртыванием кода.

Правовая основа самого перевода — Приказ МЧС России № 410 п. 12: если
предоставить отдых в другие дни недели невозможно, время «суммируется и
сотруднику предоставляются дополнительные дни отдыха СООТВЕТСТВУЮЩЕЙ
ПРОДОЛЖИТЕЛЬНОСТИ». То есть сутки отдыха — это накопленные часы,
пересчитанные по нормальной продолжительности служебного дня, а не
фиксированное «одно дежурство = одни сутки».

--- Чего этот перевод не выражает --------------------------------------

П. 11 того же приказа различает две меры:

* за службу сверх нормы и в ночное время — «дополнительное время отдыха,
  РАВНОЕ ПРОДОЛЖИТЕЛЬНОСТИ» этой службы, то есть час за час;
* за службу в выходной или праздничный день — «дополнительный ДЕНЬ
  отдыха», целиком, независимо от числа отработанных в этот день часов.

Второе из часов невыводимо: восемь выходных часов могут быть одним днём
привлечения и двумя по четыре, и приказ даёт в этих случаях разное число
дней отдыха. `CompensationLineCreated` несёт сумму часов, а не число
дней привлечения, — и добавить его туда мало, число дней знает только
`time_accounting`, где лежат сами события.

Поэтому здесь честно считается по часам для всех категорий, а расхождение
названо, а не замаскировано. Закрывать его следует передачей числа дней
привлечения по категории из `time_accounting` через `compensation`, и
делать это стоит, когда появится потребитель, которому эта точность
нужна, — а не сейчас, догадкой о том, как считать дни из часов.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.rest_balance.application.commands.accrue_rest_days.command import (
    AccrueRestDaysCommand,
)
from src.modules.rest_balance.application.ports import RestDaysBalanceRepositoryPort
from src.modules.rest_balance.domain.balance import BalanceMovement
from src.modules.rest_balance.domain.value_objects import RestDays

# Сутки отдыха в часах. Возвращается портом; тип назван, чтобы вызов
# читался как «сколько часов в сутках отдыха», а не как «число».
ResolveHoursPerRestDay = Callable[[], Awaitable[Decimal]]

# Точность: сотые доли суток — то же, что `numeric(6,2)` в БД. Округление
# ВВЕРХ по половине: остаток округляется в пользу сотрудника, потому что
# отдых — то, что ему причитается, а не то, что он должен.
DAYS_QUANTUM = Decimal("0.01")


class AccrueRestDaysHandler:
    def __init__(
        self,
        session: AsyncSession,
        repo: RestDaysBalanceRepositoryPort,
        outbox: OutboxWriter,
        hours_per_rest_day: ResolveHoursPerRestDay,
    ) -> None:
        self._session = session
        self._repo = repo
        self._outbox = outbox
        self._hours_per_rest_day = hours_per_rest_day

    async def handle(self, command: AccrueRestDaysCommand) -> BalanceMovement:
        balance = await self._repo.get(command.employee_id)

        # Проверка ДО перевода часов: повторная доставка события не должна
        # даже спрашивать правило — оно могло смениться между доставками,
        # и второй ответ дал бы другое число суток по тому же факту.
        existing = balance.accrual_for(command.compensation_line_id)
        if existing is not None:
            return existing

        hours_per_day = await self._hours_per_rest_day()
        days = (command.hours_amount / hours_per_day).quantize(
            DAYS_QUANTUM, rounding=ROUND_HALF_UP
        )
        if days <= 0:
            # Часы есть, а суток не набралось: движение на ноль суток
            # агрегат отвергнет, и это верно — но и события терять нельзя,
            # поэтому минимальная различимая величина.
            days = DAYS_QUANTUM

        movement = balance.accrue(
            amount=RestDays(days=days),
            movement_date=command.movement_date,
            compensation_line_id=command.compensation_line_id,
            legal_basis_rule_version_id=command.legal_basis_rule_version_id,
        )

        self._repo.save(balance)
        await self._outbox.enqueue(balance)
        await self._session.commit()
        return movement
