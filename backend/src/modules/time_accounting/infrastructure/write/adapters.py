"""Реализации портов `time_accounting` поверх контрактов чужих модулей.

Единственное место в модуле, которому позволено знать, что `personnel`
вообще существует. Обработчики видят только `EmployeeExistencePort` —
форму вопроса, — и потому тестируются без `personnel` и без БД
(Architecture разд. 4.2).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.domain.time_interval import TimeInterval
from src.modules.legal_rules.contracts.get_effective_conflict_policy import (
    get_effective_conflict_policy,
)
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
from src.modules.scheduling.contracts.get_planned_shifts import (
    get_planned_shifts_for_employee,
)
from src.modules.service_calendar.contracts.get_calendar_days import (
    count_days_by_type,
    get_day_types,
)
from src.modules.time_accounting.application.ports import EmployeeCalculationContext
from src.modules.time_accounting.application.services.norm_calculation import (
    NORM_CALCULATION_RULE_CODE,
    WEEKLY_NORM_FIELD,
)
from src.rule_engine.interpreter.tree_walker import evaluate_formula
from src.rule_engine.schemas.action import SetResultAction


class PersonnelEmployeeExistence:
    """`EmployeeExistencePort` поверх контракта `personnel`.

    Спрашивается именно существование, а не статус: табель за прошлый
    период открывается и уволенному — служебное время за отработанный
    период считается независимо от того, служит ли человек сегодня.
    Контракт при этом отдаёт снимок целиком, поэтому «существует» здесь —
    просто отсутствие `EmployeeNotFound`.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def exists(self, employee_id: UUID) -> bool:
        try:
            await get_employee_snapshot(self._session, employee_id=employee_id)
        except EmployeeNotFound:
            return False
        return True


class PersonnelEmployeeCalculationContext:
    """`EmployeeCalculationContextPort` поверх того же контракта.

    Перекладывание полей один в один — и это не бесполезный слой:
    `EmployeeSnapshot` принадлежит `personnel` и может обрасти чем угодно,
    а расчёт зависит ровно от шести названных здесь величин. Изменение
    чужого DTO должно ломать ЭТОТ файл, а не полтора десятка мест внутри
    модуля.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def context_of(
        self, employee_id: UUID, *, as_of: date | None = None
    ) -> EmployeeCalculationContext | None:
        """`as_of` — дата начала учётного периода (Алгоритм Б шаг 1).

        Категории должности и подразделение берутся на эту дату из
        летописи службы, а не текущие: без этого пересчёт марта 2024
        после перевода сотрудника тихо давал бы другую норму — другой
        `scope`, другая `RuleVersion`, другое число, без ошибки и без
        следа.

        Если летопись на дату молчит (сотрудник заведён без записи
        `assignment` — так делает, например, упрощённая регистрация),
        используется текущий снимок. Это осознанная деградация, а не
        умолчание: отказать было бы правильнее теоретически, но на деле
        означало бы, что ни один табель существующих сотрудников
        утвердить нельзя, пока кто-то не заполнит им летопись задним
        числом. Расхождение при этом не скрыто — расчёт пишет
        использованную правовую базу и пояс в собственный провенанс.
        """
        try:
            snapshot = await get_employee_snapshot(self._session, employee_id=employee_id)
        except EmployeeNotFound:
            return None

        position_category: str | None = None
        service_condition_category = snapshot.service_condition_category
        regime_type = snapshot.regime_type
        time_zone = snapshot.time_zone
        unit_id = snapshot.unit_id

        if as_of is not None:
            try:
                historical = await get_employee_state_as_of(
                    self._session, employee_id=employee_id, as_of=as_of
                )
            except EmployeeStateUnknownAsOf:
                pass
            else:
                position_category = historical.position_category
                service_condition_category = historical.service_condition_category
                regime_type = historical.regime_type
                time_zone = historical.time_zone
                unit_id = historical.unit_id

        return EmployeeCalculationContext(
            employee_id=snapshot.employee_id,
            unit_id=unit_id,
            legal_base=snapshot.legal_base,
            position_category=position_category,
            service_condition_category=service_condition_category,
            regime_type=regime_type,
            time_zone=time_zone,
            hired_at=snapshot.hired_at,
            dismissed_at=snapshot.dismissed_at,
        )


class LegalRulesNormRule:
    """`NormRulePort` поверх контракта `legal_rules`.

    Отсутствие применимой версии — отказ, а не умолчание в 40 часов: та же
    логика, что у минимального отдыха в `scheduling`. Подставленная норма
    выглядела бы как посчитанная и разошлась бы с законом молча.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def weekly_norm_hours(
        self, *, as_of: date, scope: dict[str, str]
    ) -> tuple[Decimal, UUID]:
        connection = await self._session.connection()
        resolved = await get_effective_rule_version(
            connection,
            rule_code=NORM_CALCULATION_RULE_CODE,
            scope=scope,
            as_of=as_of,
        )

        for action in resolved.actions:
            if isinstance(action, SetResultAction) and action.field == WEEKLY_NORM_FIELD:
                value = await evaluate_formula(action.formula, {})
                return Decimal(str(value)), resolved.id

        raise RuleVersionNotApplicable(
            f"версия правила {NORM_CALCULATION_RULE_CODE} на {as_of} не задаёт поле "
            f"{WEEKLY_NORM_FIELD!r}"
        )


class ServiceCalendarProductionCalendar:
    """`ProductionCalendarPort` поверх контракта `service_calendar`.

    Оба метода поднимают `CalendarPeriodUnavailable`, если год не
    опубликован, и перехватывать это здесь нельзя: неопубликованный
    календарь означает, что нормативного основания для расчёта ещё нет
    (год утверждается постановлением Правительства о переносах), и считать
    норму по проекту календаря — значит выдать черновик за расчёт.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def count_days_by_type(
        self, *, period_start: date, period_end: date
    ) -> dict[str, int]:
        return await count_days_by_type(
            self._session, period_start=period_start, period_end=period_end
        )

    async def day_types(self, *, period_start: date, period_end: date) -> dict[date, str]:
        return await get_day_types(
            self._session, period_start=period_start, period_end=period_end
        )


class LegalRulesConflictPolicy:
    """`ConflictPolicyPort` поверх второго контракта `legal_rules`."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def precedence_list(self, *, as_of: date) -> tuple[list[str], UUID]:
        policy = await get_effective_conflict_policy(self._session, as_of=as_of)
        return policy.precedence_list, policy.policy_version_id


class SchedulingPlannedShifts:
    """`PlannedShiftsPort` поверх контракта SD015 модуля `scheduling`.

    Именно ради этого контракт и делался: Алгоритм В шаг 6 засчитывает как
    объяснённое отсутствие только ту часть болезни, которая пересекается с
    плановой сменой.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def planned_intervals(
        self, *, employee_id: UUID, period_start: date, period_end: date
    ) -> list[TimeInterval]:
        shifts = await get_planned_shifts_for_employee(
            self._session,
            employee_id=employee_id,
            period_start=period_start,
            period_end=period_end,
        )
        return [
            TimeInterval(start=shift.start_time, end=shift.end_time) for shift in shifts
        ]
