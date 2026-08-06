"""LM004 — расчёт продолжительности отпуска.

DoD задачи: «продолжительность зависит от стажа и действующей
`RuleVersion`».

--- Почему стаж, а не только вид отпуска -------------------------------

ФЗ-141 ст. 58 ч. 3: продолжительность основного отпуска сотрудника
зависит от стажа службы (30 суток базово, с увеличением при выслуге 10,
15 и 20 лет). Считать её константой по виду отпуска значило бы выдавать
сотруднику с двадцатью годами службы столько же, сколько
новоприбывшему, — и ошибка эта была бы систематической, в пользу
работодателя.

--- Почему число дней приходит из правила, а не из кода ----------------

Пороги и прибавки — содержание нормативного акта, и меняются они его
редакцией. Зашитые в код, они потребовали бы развёртывания при каждой
поправке, а исторический пересчёт (отпуск, предоставленный три года
назад) давал бы сегодняшние цифры.

Поэтому расчёт устроен как чтение `RuleVersion` категории
`leave_entitlement`, действующей НА ДАТУ НАЧАЛА отпуска. Не на сегодня:
право возникает в момент предоставления, и редакция, вышедшая позже, к
нему не применяется.

Стаж — вход правила, а не его результат: он вычисляется из летописи
службы (`personnel`) и передаётся правилу как факт.

--- Что этот сервис НЕ делает -----------------------------------------

Не решает, положен ли отпуск вообще. Одноразовость
(`personal_circumstances_20y`), непересечение и конфликт со сменой —
предмет `LeaveEligibilityService`: это вопросы «можно ли», а здесь
«сколько».
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from uuid import UUID

from src.modules.leave_management.application.ports import (
    LeaveEntitlementRulePort,
    SeniorityPort,
)
from src.modules.leave_management.domain.value_objects import EntitlementBasis, LeaveType


@dataclass(frozen=True, kw_only=True)
class EntitlementRequest:
    employee_id: UUID
    leave_type: LeaveType
    starts_on: date


class EntitlementCalculator:
    def __init__(self, seniority: SeniorityPort, rules: LeaveEntitlementRulePort) -> None:
        self._seniority = seniority
        self._rules = rules

    async def calculate(self, request: EntitlementRequest) -> EntitlementBasis:
        seniority_years = await self._seniority.seniority_years(
            employee_id=request.employee_id, as_of=request.starts_on
        )

        rule_version_id, entitled_days = await self._rules.entitled_days(
            leave_type=request.leave_type,
            seniority_years=seniority_years,
            # На дату НАЧАЛА отпуска: право возникает в момент
            # предоставления, и редакция, вышедшая позже, к нему не
            # применяется.
            as_of=request.starts_on,
        )

        return EntitlementBasis(
            rule_version_id=rule_version_id,
            entitled_days=entitled_days,
            # Стаж сохраняется вместе с результатом: без него пересчёт
            # задним числом дал бы другое число дней, и объяснить
            # расхождение было бы нечем.
            seniority_years=seniority_years,
        )
