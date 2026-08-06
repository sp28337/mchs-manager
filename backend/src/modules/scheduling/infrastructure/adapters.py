"""Реализации межмодульных портов `scheduling`.

Здесь и только здесь этот модуль обращается к чужим модулям — и обращается
строго к их `Contracts/` (Architecture разд. 4.2). Application-слой о
`personnel` и `legal_rules` не знает вовсе: он объявил форму вопроса
(`EmployeeAvailabilityPort`, `MinimumRestPeriodPort`), а связывание живёт
на уровне инфраструктуры.
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.legal_rules.contracts.get_effective_rule_version import (
    RuleVersionNotApplicable,
    get_effective_rule_version,
)
from src.modules.personnel.contracts.get_employee_snapshot import (
    EmployeeNotFound,
    get_employee_snapshot,
)
from src.modules.scheduling.application.services.rest_period_policy import (
    MINIMUM_REST_PERIOD_RULE_CODE,
)
from src.rule_engine.interpreter.tree_walker import as_number, evaluate_formula
from src.rule_engine.schemas.action import SetResultAction

MINIMUM_REST_FIELD = "minimum_rest_hours"


class PersonnelEmployeeAvailability:
    """`EmployeeAvailabilityPort` поверх контракта `personnel`."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def employment_status_of(self, employee_id: UUID) -> str | None:
        try:
            snapshot = await get_employee_snapshot(self._session, employee_id=employee_id)
        except EmployeeNotFound:
            return None
        return snapshot.employment_status


class LegalRulesMinimumRestPeriod:
    """`MinimumRestPeriodPort` поверх контракта `legal_rules`.

    Величина отдыха — не константа и не колонка, а результат вычисления
    `RuleVersion` категории `minimum_rest_period`, действующей НА ДАТУ
    смены (Принцип 0.2). Поэтому здесь два шага: контракт находит версию,
    а `rule_engine` вычисляет её формулу.

    Отсутствие применимой версии — это отказ, а не «ноль»: ноль означал бы
    «отдых не требуется», то есть тихо разрешил бы ставить смены подряд.
    Ошибка контракта поднимается наверх без перехвата и отображается в 422.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def minimum_rest_hours(self, *, as_of: date, scope: dict[str, str]) -> float:
        connection = await self._session.connection()
        resolved = await get_effective_rule_version(
            connection,
            rule_code=MINIMUM_REST_PERIOD_RULE_CODE,
            scope=scope,
            as_of=as_of,
        )

        for action in resolved.actions:
            if isinstance(action, SetResultAction) and action.field == MINIMUM_REST_FIELD:
                # `as_number` — не церемония: с тех пор как литерал
                # научился быть строкой (Алгоритм К шаг 4), правило может
                # вернуть нечисловое значение, и тогда «минимальный отдых»
                # обязан отказать, а не превратиться в NaN где-то ниже.
                return as_number(await evaluate_formula(action.formula, {}))

        raise RuleVersionNotApplicable(
            f"версия правила {MINIMUM_REST_PERIOD_RULE_CODE} на {as_of} не задаёт "
            f"поле '{MINIMUM_REST_FIELD}'"
        )
