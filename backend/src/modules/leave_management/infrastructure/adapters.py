"""Адаптеры к контрактам чужих модулей.

`SchedulingApprovedShifts` — инвариант 9.1.4, `PersonnelSeniority` —
вход расчёта продолжительности (ФЗ-141 ст. 58 ч. 3),
`LegalRulesLeaveEntitlement` — само правило.
"""

from __future__ import annotations

import logging
from datetime import date
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.leave_management.domain.value_objects import LeaveType
from src.modules.legal_rules.contracts.get_effective_rule_version import (
    RuleVersionNotApplicable,
    get_effective_rule_version,
)
from src.modules.personnel.contracts.get_employee_snapshot import (
    EmployeeNotFound,
    get_employee_snapshot,
)
from src.modules.scheduling.contracts.get_planned_shifts import (
    get_planned_shifts_for_employee,
)
from src.rule_engine.interpreter.tree_walker import as_number, evaluate_formula
from src.rule_engine.schemas.action import SetResultAction

logger = logging.getLogger(__name__)

LEAVE_ENTITLEMENT_RULE_CODE = "LEAVE.ENTITLEMENT_DAYS"
ENTITLED_DAYS_FIELD = "entitled_days"

# Статус графика, при котором смена считается обязательством, а не
# намерением. Строкой, а не импортом чужого enum (Architecture разд. 4.2):
# значение приходит из контракта `scheduling` такой же строкой.
APPROVED_SCHEDULE_STATUS = "approved"


class SchedulingApprovedShifts:
    """`ApprovedShiftPort` поверх контракта `scheduling`.

    Отбираются ТОЛЬКО смены утверждённых графиков: смена из черновика —
    намерение, а не обязательство, и запрещать по ней отпуск значило бы
    дать планировщику власть, которой у него нет.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def approved_shifts(
        self, *, employee_id: UUID, period_start: date, period_end: date
    ) -> list[tuple[UUID, date, date]]:
        shifts = await get_planned_shifts_for_employee(
            self._session,
            employee_id=employee_id,
            period_start=period_start,
            period_end=period_end,
        )
        return [
            (s.shift_id, s.start_time.date(), s.end_time.date())
            for s in shifts
            if s.schedule_status == APPROVED_SCHEDULE_STATUS
        ]


class PersonnelSeniority:
    """`SeniorityPort` поверх контракта `personnel`.

    Выслуга считается от даты приёма на службу до начала отпуска, в
    полных годах. Это упрощение, и оно названо: ФЗ-141 ст. 38 включает в
    стаж службы периоды, которых карточка сотрудника не знает (служба в
    других органах, учёба в образовательных организациях МЧС, льготное
    исчисление). Точный стаж — предмет кадрового учёта выслуги, отдельной
    подсистемы, и подменять её вычитанием дат было бы неверно.

    Пока такого источника нет, `hired_at` даёт нижнюю оценку: сотрудник
    получит отпуск не длиннее положенного, а не длиннее — ошибка в
    пользу службы, а не в пользу сотрудника, поэтому она не должна
    остаться незамеченной. Отсюда предупреждение в журнале при выслуге
    вблизи порогов и явное поле `seniority_years` в приказе.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def seniority_years(self, *, employee_id: UUID, as_of: date) -> int | None:
        try:
            snapshot = await get_employee_snapshot(self._session, employee_id=employee_id)
        except EmployeeNotFound:
            return None

        hired = snapshot.hired_at
        years = as_of.year - hired.year
        if (as_of.month, as_of.day) < (hired.month, hired.day):
            years -= 1
        return max(years, 0)


class LegalRulesLeaveEntitlement:
    """`LeaveEntitlementRulePort` поверх контракта `legal_rules`.

    `scope` — вид отпуска и «ступень» выслуги. Ступень, а не сами годы:
    правило, заведённое на каждое возможное число лет, потребовало бы
    сорока версий вместо четырёх, и первая же поправка к ФЗ-141
    заставила бы переиздать их все.

    Ступени соответствуют ст. 58 ч. 3 ФЗ-141: до 10 лет, 10-15, 15-20,
    20 и более. Сами ЧИСЛА ДНЕЙ в коде не появляются — они содержание
    нормы и живут в `formula_definition`.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def entitled_days(
        self, *, leave_type: LeaveType, seniority_years: int | None, as_of: date
    ) -> tuple[UUID, int]:
        scope = {
            "leave_type": leave_type.value,
            "seniority_band": _seniority_band(seniority_years),
        }

        resolved = await self._resolve(scope=scope, as_of=as_of)

        for action in resolved.actions:
            if isinstance(action, SetResultAction) and action.field == ENTITLED_DAYS_FIELD:
                days = int(as_number(await evaluate_formula(action.formula, {})))
                return resolved.id, days

        raise RuleVersionNotApplicable(
            f"версия правила {LEAVE_ENTITLEMENT_RULE_CODE} для scope {scope} на "
            f"{as_of} не задаёт поле {ENTITLED_DAYS_FIELD!r}: продолжительность "
            f"отпуска определить не по чему"
        )

    async def _resolve(self, *, scope: dict[str, str], as_of: date):  # type: ignore[no-untyped-def]
        connection = await self._session.connection()
        return await get_effective_rule_version(
            connection,
            rule_code=LEAVE_ENTITLEMENT_RULE_CODE,
            scope=scope,
            as_of=as_of,
        )


def _seniority_band(years: int | None) -> str:
    """Ступени выслуги по ФЗ-141 ст. 58 ч. 3.

    `unknown` при отсутствии данных — не «до 10 лет»: подставить младшую
    ступень значило бы молча выдать сотруднику с двадцатью годами службы
    отпуск новичка. Правило для `unknown` заводится явно, и его
    отсутствие даёт честный отказ вместо тихой ошибки.
    """
    if years is None:
        return "unknown"
    if years < 10:
        return "under_10"
    if years < 15:
        return "from_10_to_15"
    if years < 20:
        return "from_15_to_20"
    return "from_20"
