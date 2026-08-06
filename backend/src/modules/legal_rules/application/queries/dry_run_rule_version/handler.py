"""Песочница для черновика версии правила.

`POST /legal-rules/rule-versions/{versionId}/dry-run` — «проверить
черновик версии на исторических фактах». Смысл операции целиком в одном:
юрист, меняющий норму, обязан увидеть последствия ДО публикации, потому
что после публикации версия неизменяема (инвариант 2.2), а расчёты
периодов, попавших в её интервал, поменяются автоматически.

--- Что сравнивается ---------------------------------------------------

Черновик против ДЕЙСТВУЮЩЕЙ версии того же правила и того же `scope` на
конец исторического периода. Не против «предыдущей по номеру»: номер
версии — порядок внесения, а не порядок действия, и сравнивать надо с
тем, по чему считают сейчас.

Период запроса определяет, НА КАКУЮ ДАТУ искать действующую версию для
сравнения: правка, безопасная сегодня, могла бы менять расчёт за прошлый
год, если тогда действовала другая редакция.

--- Чего эта операция НЕ делает ---------------------------------------

Ничего не меняет и ничего не сохраняет. Ни статус черновика, ни
проекции, ни outbox — сравнение существует только в ответе. Это не
осторожность, а определение: песочница, оставляющая след, песочницей не
является.

--- Ограничение, которое стоит назвать --------------------------------

Сравниваются ЗНАЧЕНИЯ ФОРМУЛ, а не пересчитанные `HoursBreakdown`
целиком. Полный пересчёт потребовал бы прогнать Алгоритмы Б-З с чужими
правилами, то есть вызвать `time_accounting` — модуль, о существовании
которого `legal_rules` не знает и знать не должен (Architecture
разд. 4.2).

Для правил, задающих одну величину (`weekly_norm_hours`,
`minimum_rest_hours`, коэффициенты компенсации), этого достаточно:
изменение величины и есть изменение расчёта. Для правил, влияющих на
расчёт не значением, а структурой, потребуется отдельная операция на
стороне `time_accounting` — и заводить её следует, когда такое правило
появится, а не впрок.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy.ext.asyncio import AsyncConnection

from src.modules.legal_rules.application.ports import RuleRepositoryPort
from src.rule_engine.interpreter.tree_walker import as_number, evaluate_formula
from src.rule_engine.interpreter.version_resolver import (
    NoApplicableRuleVersionError,
    resolve_effective_version,
)
from src.rule_engine.schemas.action import Action, SetResultAction


@dataclass(frozen=True, kw_only=True)
class SampleDifference:
    """Расхождение по конкретному сотруднику. Список пока всегда пуст —
    см. комментарий в `dry_run_rule_version`."""

    employee_id: UUID
    old_value: float
    new_value: float


@dataclass(frozen=True, kw_only=True)
class DryRunResult:
    # Additive относительно `DryRunResult` спецификации: без самих величин
    # ответ сообщал бы «расхождение есть», не говоря какое, — и юристу
    # пришлось бы искать его глазами по двум версиям правила.
    old_value: float
    new_value: float
    compared_entities: int
    differences_found: int
    sample_differences: list[SampleDifference]


class RuleVersionNotFound(LookupError):
    """Черновик не найден. Отображается в 404."""


class DryRunNotApplicable(LookupError):
    """Сравнивать не с чем или нечего.

    Отдельный тип, а не пустой результат: «расхождений нет» и «сравнение
    не выполнено» — разные ответы, и юрист, увидевший ноль вместо отказа,
    решил бы, что правка безопасна. Отображается в 422.
    """


async def dry_run_rule_version(
    connection: AsyncConnection,
    *,
    rules: RuleRepositoryPort,
    version_id: UUID,
    historical_period_start: date,
    historical_period_end: date,
    sample_size: int,
) -> DryRunResult:
    # Черновик достаётся агрегатом через порт, а не выборкой по таблицам:
    # `application` не знает про `infrastructure` (Architecture разд. 3, 7),
    # и это не формальность — сырой SELECT обошёл бы `Scope`-VO и
    # `RuleVersion`, то есть ровно те типы, на которых держится сравнение.
    rule = await rules.get_by_version_id(version_id)
    if rule is None:
        raise RuleVersionNotFound(str(version_id))
    draft = rule.get_version(version_id)

    scope = draft.scope.as_dict()

    try:
        current = await resolve_effective_version(
            connection,
            rule_code=rule.code,
            scope=scope,
            as_of=historical_period_end,
        )
    except NoApplicableRuleVersionError as exc:
        raise DryRunNotApplicable(
            f"на {historical_period_end} нет действующей версии правила {rule.code!r} "
            f"для scope {scope}: сравнивать черновик не с чем — это первая "
            f"версия, и её публикация ничего не меняет задним числом"
        ) from exc

    new_value = await _single_value(draft.formula_definition)
    old_value = await _single_value_of(current.actions)
    if new_value is None or old_value is None:
        raise DryRunNotApplicable(
            f"правило {rule.code!r} задаёт не одну величину, а структуру расчёта: "
            f"сравнение значений формул для него бессмысленно "
            f"(см. докстринг модуля)"
        )

    differs = new_value != old_value
    return DryRunResult(
        old_value=old_value,
        new_value=new_value,
        # Поимённого сравнения здесь нет, и это граница модулей, а не
        # недоделка.
        #
        # `DryRunResult` спецификации содержит `sampleDifferences` с
        # `employeeId`, то есть предполагает прогон по реальным расчётам.
        # Расчёты принадлежат `time_accounting`, и достать их отсюда можно
        # было бы только двумя способами: сырым SQL в чужую схему (прямо
        # запрещено PostgreSQL_Logical_Model разд. 10) или зависимостью
        # `legal_rules -> time_accounting`, которая развернула бы
        # направление связи — на `legal_rules` опираются все, он не
        # опирается ни на кого.
        #
        # Поимённый прогон — операция `time_accounting` (ретроспективный
        # пересчёт, Алгоритм М), и заводить её следует там. Здесь
        # сравниваются величины: для правил, задающих одно число, разница
        # величин И ЕСТЬ разница расчёта.
        compared_entities=0,
        differences_found=1 if differs else 0,
        sample_differences=[],
    )


_actions_adapter: TypeAdapter[list[Action]] = TypeAdapter(list[Action])


async def _single_value_of(parsed: list[Action]) -> float | None:
    """То же, но для уже разобранных действий: резолвер отдаёт
    `ResolvedRuleVersion` с готовым `list[Action]`, а черновик читается
    сырым jsonb."""
    set_results = [a for a in parsed if isinstance(a, SetResultAction)]
    if len(set_results) != 1:
        return None
    return as_number(await evaluate_formula(set_results[0].formula, {}))


async def _single_value(actions: object) -> float | None:
    """Значение единственного `set_result`-действия правила.

    `None`, если действий не одно: правило, задающее несколько полей,
    сравнением одной величины не описывается.
    """
    raw = json.loads(actions) if isinstance(actions, str) else actions
    parsed = _actions_adapter.validate_python(raw)
    set_results = [a for a in parsed if isinstance(a, SetResultAction)]
    if len(set_results) != 1:
        return None
    return as_number(await evaluate_formula(set_results[0].formula, {}))
