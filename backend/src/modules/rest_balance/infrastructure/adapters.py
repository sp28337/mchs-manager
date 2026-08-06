"""Адаптеры к контрактам чужих модулей.

--- Коэффициент перевода часов в сутки ---------------------------------

Алгоритм Л требует брать его из `RuleVersion` категории
`compensation_coefficient`, а SRS 9.3.1 держит точное значение открытым
вопросом. Поэтому здесь — чтение правила, а не константа.

Читается ИМЕННО ТА версия, на которую сослалась компенсация
(`legal_basis_rule_version_id` из события), а не действующая сегодня. Это
не осторожность: провенанс начисления (инвариант 8.1.2) и норма, по
которой оно посчитано, обязаны быть одним документом. Правило, сменившееся
между финализацией дела и разбором события, дало бы сутки по одной
редакции со ссылкой на другую — и расхождение обнаружилось бы при первой
же служебной проверке, когда объяснить его было бы уже нечем.

--- Умолчание ----------------------------------------------------------

Значение по умолчанию есть, и это осознанно. Без него первое же
начисление по версии, не задающей коэффициент, отказало бы, сообщение
осталось бы неподтверждённым и вернулось на следующем тике — то есть
сотрудник не получил бы ничего, и никто бы об этом не узнал, кроме
журнала воркера.

Умолчание — 8 часов на сутки отдыха: нормальная продолжительность
служебного дня при 40-часовой служебной неделе (ФЗ-141 ст. 54, ТК РФ
ст. 91). Приказ МЧС России № 410 п. 12 говорит о «дополнительных днях
отдыха соответствующей продолжительности», то есть о пересчёте
накопленных часов по продолжительности дня, а не по длине дежурства.

Умолчание логируется предупреждением: молча применённая константа в
расчёте того, что сотруднику причитается, — ровно тот случай, когда
«работает» и «верно» расходятся незаметно.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.legal_rules.contracts.get_rule_version_by_id import (
    RuleVersionNotFound,
    get_rule_version_by_id,
)
from src.rule_engine.interpreter.tree_walker import as_number, evaluate_formula
from src.rule_engine.schemas.action import SetResultAction

logger = logging.getLogger(__name__)

HOURS_PER_REST_DAY_FIELD = "hours_per_rest_day"

# См. докстринг модуля. Тот же знаменатель, что у прогноза компенсации
# (`compensation/infrastructure/forecast.py`): две разные цифры для одного
# пересчёта означали бы, что прогноз обещает не то, что начислено.
DEFAULT_HOURS_PER_REST_DAY = Decimal(8)


class LegalRulesRestDayLength:
    """`ResolveHoursPerRestDay` поверх контракта `legal_rules`.

    `version_id` — `None`, если событие пришло без провенанса. Такое
    событие уже нарушает инвариант 8.1.2, но отвергать его здесь нечем:
    отказ оставил бы сотрудника без начисления, а сутки ему причитаются
    независимо от полноты чужого payload.
    """

    def __init__(self, session: AsyncSession, *, version_id: UUID | None) -> None:
        self._session = session
        self._version_id = version_id

    async def hours_per_rest_day(self) -> Decimal:
        if self._version_id is None:
            logger.warning(
                "rest_balance: событие без legal_basis_rule_version_id — "
                "применяется продолжительность служебного дня по умолчанию (%s ч)",
                DEFAULT_HOURS_PER_REST_DAY,
            )
            return DEFAULT_HOURS_PER_REST_DAY

        try:
            version = await get_rule_version_by_id(
                self._session, version_id=self._version_id
            )
        except RuleVersionNotFound:
            logger.warning(
                "rest_balance: версия правила %s не найдена — применяется "
                "продолжительность служебного дня по умолчанию (%s ч)",
                self._version_id,
                DEFAULT_HOURS_PER_REST_DAY,
            )
            return DEFAULT_HOURS_PER_REST_DAY

        for action in version.actions:
            if isinstance(action, SetResultAction) and action.field == HOURS_PER_REST_DAY_FIELD:
                hours = Decimal(str(as_number(await evaluate_formula(action.formula, {}))))
                if hours > 0:
                    return hours
                logger.warning(
                    "rest_balance: версия %s задаёт %s = %s — величина "
                    "неположительна, применяется умолчание (%s ч)",
                    self._version_id,
                    HOURS_PER_REST_DAY_FIELD,
                    hours,
                    DEFAULT_HOURS_PER_REST_DAY,
                )
                return DEFAULT_HOURS_PER_REST_DAY

        logger.info(
            "rest_balance: версия правила %s (%s) не задаёт поле %r — "
            "применяется продолжительность служебного дня по умолчанию (%s ч)",
            self._version_id,
            version.rule_code,
            HOURS_PER_REST_DAY_FIELD,
            DEFAULT_HOURS_PER_REST_DAY,
        )
        return DEFAULT_HOURS_PER_REST_DAY
