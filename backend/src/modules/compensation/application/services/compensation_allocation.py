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

--- Отступление от шага 5 спецификации ---------------------------------

Шаг 5 Алгоритма К предписывает при отсутствии рапорта «применить форму по
умолчанию, зафиксированную в `formula_definition` (как правило —
денежная)». Форма по умолчанию читается по-прежнему, но денежной она быть
не может, и это не ужесточение, а требование двух актов:

* Приказ МЧС России № 410 п. 18 — «**по просьбе** сотрудника... **вместо**
  предоставления дополнительных дней отдыха, ему **может быть** выплачена
  денежная компенсация»;
* Приказ МЧС России от 27.06.2024 № 539 п. 103 — компенсация выплачивается
  «в случае непредоставления дополнительного времени отдыха... **по
  рапорту сотрудника и на основании решения руководителя**».

Законная форма — дополнительное время отдыха (п. 11 Приказа № 410);
денежная возникает только из волеизъявления. Поэтому правило, объявившее
денежную форму по умолчанию, здесь приводится к отдыху, а не применяется
как есть и не отвергается: отказ заблокировал бы расчёт всему периоду
из-за данных, которые сотрудник вправе исправить рапортом до финализации
дела, а применение назначило бы выплату, для которой нет основания.

Обратной подмены нет: рапорт с денежной формой исполняется дословно.

--- Что осталось за пределами модели -----------------------------------

Приказ № 539 п. 111 лишает денежной компенсации за сверхурочную работу
сотрудников, выполняющих задачи в условиях военного или чрезвычайного
положения, вооружённого конфликта, контртеррористической операции,
ликвидации последствий аварий и катастроф. Признака «особые условия» в
модели нет — ни `personnel`, ни `time_accounting` его не ведут, — и
завести его догадкой нельзя: он определяется приказом о привлечении, а
не расчётом. До появления такого источника рапорт о денежной форме от
такого сотрудника система примет.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date
from uuid import UUID

from src.modules.compensation.domain.compensation_case import CompensationCase
from src.modules.compensation.domain.value_objects import (
    CompensationForm,
    EmployeeElection,
    HourCategory,
)

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
        elections: dict[HourCategory, EmployeeElection] | None = None,
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
            election = elections.get(category) if rule.election_allowed else None

            # Рапорт исполняется дословно; без рапорта — законная форма
            # (см. «Отступление от шага 5» в докстринге модуля).
            form = election.form if election is not None else _statutory_form(rule.default_form)

            case.add_line(
                hour_category=category,
                hours_amount=case.compensable.of(category),
                compensation_form=form,
                legal_basis_rule_version_id=rule.rule_version_id,
                election_allowed=rule.election_allowed,
                # Дата рапорта, а не времени расчёта: волеизъявление —
                # юридический факт, и Приказ № 410 п. 16 отводит на его
                # передачу табельщику три рабочих дня, то есть считает
                # момент подачи существенным.
                elected_at=election.elected_at if election is not None else None,
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


def _statutory_form(default_form: CompensationForm) -> CompensationForm:
    """Форма, назначаемая без рапорта.

    Форма правила проходит насквозь, кроме денежной: Приказ № 410 п. 11
    устанавливает дополнительное время отдыха как саму меру компенсации,
    а п. 18 делает денежную выплату заменой по просьбе сотрудника —
    значит, без просьбы остаётся отдых.

    Функция отдельная, а не `if` по месту: она называет правило, по
    которому реализация расходится со спецификацией, и его единственное
    место.
    """
    if default_form is CompensationForm.MONETARY:
        return CompensationForm.ADDITIONAL_REST_TIME
    return default_form
