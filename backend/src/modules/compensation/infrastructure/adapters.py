"""Реализации портов `compensation` поверх контрактов чужих модулей.

Единственное место, которому позволено знать, что `time_accounting` и
`legal_rules` существуют (Architecture разд. 4.2).
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.compensation.application.ports import ApprovedPeriod
from src.modules.compensation.application.services.compensation_allocation import (
    COMPENSATION_COEFFICIENT_RULE_CODE,
    DEFAULT_FORM_FIELD,
    ELECTION_ALLOWED_FIELD,
    CompensationRule,
)
from src.modules.compensation.domain.value_objects import CompensationForm
from src.modules.legal_rules.contracts.get_effective_rule_version import (
    RuleVersionNotApplicable,
    get_effective_rule_version,
)
from src.modules.personnel.contracts.get_employee_snapshot import (
    EmployeeNotFound,
    get_employee_snapshot,
)
from src.modules.personnel.contracts.get_employee_snapshot_as_of import (
    EmployeeStateUnknownAsOf,
    get_employee_state_as_of,
)
from src.modules.time_accounting.contracts.get_approved_breakdown import (
    ApprovedBreakdownNotFound,
    get_approved_breakdown,
)
from src.rule_engine.interpreter.tree_walker import evaluate_formula
from src.rule_engine.schemas.action import SetResultAction


class TimeAccountingApprovedPeriod:
    """`ApprovedPeriodPort` поверх контракта `time_accounting`."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def approved_period(
        self, *, employee_id: UUID, period_start: date, period_end: date
    ) -> ApprovedPeriod | None:
        try:
            breakdown = await get_approved_breakdown(
                self._session,
                employee_id=employee_id,
                period_start=period_start,
                period_end=period_end,
            )
        except ApprovedBreakdownNotFound:
            return None

        return ApprovedPeriod(
            timesheet_id=breakdown.timesheet_id,
            employee_id=breakdown.employee_id,
            period_start=breakdown.period_start,
            period_end=breakdown.period_end,
            is_approved=breakdown.is_approved,
            night_hours=breakdown.night_hours,
            holiday_hours=breakdown.holiday_hours,
            weekend_hours=breakdown.weekend_hours,
            overtime_hours=breakdown.overtime_hours,
            # Правовая база берётся из ПРОВЕНАНСА расчёта, а не из
            # текущей карточки сотрудника. Это существенно: компенсация
            # обязана определяться по той же правовой базе, по которой
            # посчитаны часы, — иначе переход сотрудника из гражданского
            # персонала в аттестованный состав задним числом изменил бы
            # правило компенсации за уже отработанный период.
            legal_base=breakdown.computed_from_legal_base,
            regime_type=await self._regime_of(employee_id, period_start),
        )

    async def _regime_of(self, employee_id: UUID, as_of: date) -> str:
        """Режим службы НА ДАТУ периода.

        Из летописи, а не из текущей карточки: перевод оперативного
        сотрудника на административную должность в апреле не должен
        менять состав компенсируемых часов за март (Приказ № 410 п. 14
        привязан к тому, как человек служил, а не как служит сейчас).
        """
        try:
            state = await get_employee_state_as_of(
                self._session, employee_id=employee_id, as_of=as_of
            )
        except EmployeeStateUnknownAsOf:
            snapshot = await get_employee_snapshot(self._session, employee_id=employee_id)
            return snapshot.regime_type
        return state.regime_type


class LegalRulesCompensationRule:
    """`CompensationRulePort` поверх контракта `legal_rules`.

    Отсутствие действующего правила — отказ, а не форма по умолчанию:
    «денежная, раз ничего не нашли» была бы решением системы за
    законодателя, причём тем самым, которое лишает сотрудника выбора
    (ТК РФ ст. 152/153).
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def rule_for(self, *, as_of: date, scope: dict[str, str]) -> CompensationRule:
        connection = await self._session.connection()
        resolved = await get_effective_rule_version(
            connection,
            rule_code=COMPENSATION_COEFFICIENT_RULE_CODE,
            scope=scope,
            as_of=as_of,
        )

        default_form: CompensationForm | None = None
        election_allowed = False

        for action in resolved.actions:
            if not isinstance(action, SetResultAction):
                continue
            if action.field == DEFAULT_FORM_FIELD:
                default_form = CompensationForm(str(await evaluate_formula(action.formula, {})))
            elif action.field == ELECTION_ALLOWED_FIELD:
                election_allowed = bool(await evaluate_formula(action.formula, {}))

        if default_form is None:
            raise RuleVersionNotApplicable(
                f"версия правила {COMPENSATION_COEFFICIENT_RULE_CODE} для scope {scope} "
                f"на {as_of} не задаёт поле {DEFAULT_FORM_FIELD!r}: форму компенсации "
                f"определить не по чему"
            )

        return CompensationRule(
            rule_version_id=resolved.id,
            default_form=default_form,
            election_allowed=election_allowed,
        )


class PersonnelEmployeeUnit:
    """`EmployeeUnitPort` поверх контракта `personnel`.

    Если летопись службы на дату молчит (сотрудник заведён без записи
    `assignment`), берётся текущее подразделение — та же осознанная
    деградация, что в `time_accounting`: отказ означал бы, что дело о
    компенсации нельзя завести, пока кто-то не заполнит летопись задним
    числом.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def unit_at(self, *, employee_id: UUID, as_of: date) -> UUID | None:
        try:
            state = await get_employee_state_as_of(
                self._session, employee_id=employee_id, as_of=as_of
            )
        except EmployeeStateUnknownAsOf:
            try:
                snapshot = await get_employee_snapshot(self._session, employee_id=employee_id)
            except EmployeeNotFound:
                return None
            return snapshot.unit_id
        return state.unit_id
