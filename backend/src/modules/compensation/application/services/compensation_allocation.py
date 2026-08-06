"""CO006 — Алгоритм К: распределение компенсации.

Domain Model разд. 10.5 (`CompensationAllocationService`).

Для каждой непустой категории часов (шаг 2) находится действующая на
КОНЕЦ периода `RuleVersion` категории `compensation_coefficient` (шаг 3),
из неё извлекается форма компенсации и признак `election_allowed`
(шаг 4-6), и создаётся строка (шаг 7).

--- Почему правило берётся на конец периода, а не на начало ------------

Шаг 3 оговаривает это прямо: «компенсация определяется правилами,
действовавшими на момент возникновения обязательства — конец периода,
когда факт уже зафиксирован». Разница не умозрительная: норма периода
(Алгоритм Б) определяется правилами на его НАЧАЛО, потому что она
устанавливает, сколько человек должен отслужить, и должна быть известна
заранее. Обязательство же компенсировать возникает тогда, когда часы
отработаны, то есть к концу периода.

Если ведомственный акт сменился в середине месяца, эти две даты дадут
разные версии — и обе будут правильными, каждая для своего вопроса.

--- Чего этот сервис НЕ делает -----------------------------------------

Он не считает деньги. Ни коэффициента, ни ставки, ни суммы здесь нет, и
это не упущение: `CompensationLine` (Domain Model разд. 7.1) несёт часы и
форму, а не рубли. Перевод часов в оплату — предмет расчёта денежного
довольствия, отдельной системы; здесь фиксируется, ЗА ЧТО и В КАКОЙ ФОРМЕ
полагается компенсация, со ссылкой на норму.

Именно поэтому `election_allowed` и форма по умолчанию читаются из
`formula_definition`, а сам коэффициент — нет: он там есть, но
потребителя у него в этом модуле не существует.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date
from uuid import UUID

from src.modules.compensation.domain.compensation_case import CompensationCase
from src.modules.compensation.domain.value_objects import CompensationForm, HourCategory

# Поля, которые Алгоритм К шаг 4 ожидает найти в `formula_definition`
# версии правила.
DEFAULT_FORM_FIELD = "default_compensation_form"
ELECTION_ALLOWED_FIELD = "election_allowed"

COMPENSATION_COEFFICIENT_RULE_CODE = "COMPENSATION.COEFFICIENT"


@dataclass(frozen=True, kw_only=True)
class CompensationRule:
    """То, что Алгоритм К шаг 4 извлекает из версии правила.

    `rule_version_id` — не служебное поле, а обязательный провенанс
    (шаг 9): строка компенсации без ссылки на норму, по которой она
    возникла, есть начисление «из воздуха».
    """

    rule_version_id: UUID
    default_form: CompensationForm
    election_allowed: bool


ResolveCompensationRule = Callable[[date, dict[str, str]], Awaitable["CompensationRule"]]


class CompensationAllocationService:
    """Чистая функция от дела, правил и (опционально) волеизъявления.

    Резолвер правил приходит вызываемым объектом, а не портом-объектом:
    сервис не импортирует `legal_rules` и потому тестируется без БД — тот
    же приём, что у `RestPeriodPolicyService` в `scheduling` и
    `NormCalculationService` в `time_accounting`.
    """

    def __init__(self, resolve_rule: ResolveCompensationRule) -> None:
        self._resolve_rule = resolve_rule

    async def allocate(
        self,
        *,
        case: CompensationCase,
        legal_base: str,
        elections: dict[HourCategory, CompensationForm] | None = None,
    ) -> list[HourCategory]:
        """Заполняет дело строками. Возвращает категории, по которым
        начисление произведено.

        `elections` — уже поданные рапорты сотрудника (шаг 5). Пустой
        словарь означает «рапортов нет», и тогда применяется форма по
        умолчанию из правила. Отличать «срок подачи ещё не истёк» от «истёк
        и рапорта не будет» здесь не нужно: дело финализируется отдельным
        действием, и до финализации волеизъявление можно записать
        (`record_election`).
        """
        if case.compensable is None:
            raise ValueError(
                "дело загружено без утверждённого HoursBreakdown: распределять нечего"
            )

        elections = elections or {}
        allocated: list[HourCategory] = []

        # Шаг 2: только непустые категории. Строка на ноль часов не
        # компенсация, а шум, и агрегат её всё равно отвергнет.
        for category in case.compensable.non_empty_categories():
            rule = await self._rule_for(
                category=category, legal_base=legal_base, as_of=case.period.end
            )

            # Шаги 5-6: выбор сотрудника учитывается только там, где
            # правило его допускает. Рапорт по категории, где формы выбора
            # нет, не игнорируется молча — он вообще не может быть подан:
            # агрегат отвергает `record_election` для таких строк.
            form = rule.default_form
            if rule.election_allowed and category in elections:
                form = elections[category]

            case.add_line(
                hour_category=category,
                hours_amount=case.compensable.of(category),
                compensation_form=form,
                legal_basis_rule_version_id=rule.rule_version_id,
                election_allowed=rule.election_allowed,
            )
            allocated.append(category)

        return allocated

    async def _rule_for(
        self, *, category: HourCategory, legal_base: str, as_of: date
    ) -> CompensationRule:
        """Шаг 3: `scope = {legal_base, hour_category}` на конец периода."""
        return await self._resolve_rule(
            as_of, {"legal_base": legal_base, "hour_category": category.value}
        )
