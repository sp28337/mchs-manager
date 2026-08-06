"""CO007 — юнит-тесты Алгоритма К (распределение компенсации).

Сервис — чистая функция от дела, правил и волеизъявлений, поэтому ни БД,
ни HTTP здесь нет. Резолвер правил подставляется заглушкой: смысл тестов
в том, ЧТО сервис делает с полученным правилом, а не в том, как он его
достаёт.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from src.modules.compensation.application.services.compensation_allocation import (
    CompensationAllocationService,
    CompensationRule,
)
from src.modules.compensation.domain.compensation_case import CompensationCase
from src.modules.compensation.domain.value_objects import (
    AccountingPeriod,
    CompensableHours,
    CompensationForm,
    EmployeeElection,
    HourCategory,
)

pytestmark = pytest.mark.asyncio

OVERTIME_RULE = uuid4()
NIGHT_RULE = uuid4()


def case(**hours: str) -> CompensationCase:
    return CompensationCase.open_for(
        employee_id=uuid4(),
        timesheet_id=uuid4(),
        unit_id=uuid4(),
        period=AccountingPeriod(start=date(2026, 3, 1), end=date(2026, 4, 1)),
        compensable=CompensableHours(
            night_hours=Decimal(hours.get("night", "0")),
            holiday_hours=Decimal(hours.get("holiday", "0")),
            weekend_hours=Decimal(hours.get("weekend", "0")),
            overtime_hours=Decimal(hours.get("overtime", "0")),
        ),
    )


def _service(
    rules: dict[str, CompensationRule], *, seen: list[date] | None = None
) -> CompensationAllocationService:
    async def resolve(as_of: date, scope: dict[str, str]) -> CompensationRule:
        if seen is not None:
            seen.append(as_of)
        return rules[scope["hour_category"]]

    return CompensationAllocationService(resolve)


RAPPORT_AT = datetime(2026, 4, 5, 10, tzinfo=UTC)


def _elects(form: CompensationForm) -> EmployeeElection:
    return EmployeeElection(form=form, elected_at=RAPPORT_AT)


def _rule(
    version: UUID,
    form: CompensationForm = CompensationForm.ADDITIONAL_REST_TIME,
    *,
    election_allowed: bool = False,
) -> CompensationRule:
    return CompensationRule(
        rule_version_id=version, default_form=form, election_allowed=election_allowed
    )


# ------------------------------------------------------------ шаг 2


async def test_only_non_empty_categories_get_a_line() -> None:
    """«Для каждой НЕПУСТОЙ категории часов». Категории, которых в периоде
    не было, строк не порождают — иначе дело заполнилось бы нулями,
    каждый из которых выглядел бы как начисление."""
    subject = case(overtime="20", night="12")
    service = _service(
        {"overtime": _rule(OVERTIME_RULE), "night": _rule(NIGHT_RULE)}
    )

    allocated = await service.allocate(case=subject, legal_base="fps_service")

    assert allocated == [HourCategory.NIGHT, HourCategory.OVERTIME]
    assert len(subject.lines) == 2
    assert {line.hour_category for line in subject.lines} == {
        HourCategory.NIGHT,
        HourCategory.OVERTIME,
    }


async def test_a_period_without_compensable_hours_produces_nothing() -> None:
    subject = case()
    allocated = await _service({}).allocate(case=subject, legal_base="fps_service")
    assert allocated == []
    assert subject.lines == []


# ------------------------------------------------------------ шаг 3


async def test_the_rule_is_resolved_at_the_END_of_the_period() -> None:
    """Шаг 3 дословно: «компенсация определяется правилами, действовавшими
    на момент возникновения обязательства — конец периода».

    Отличие от Алгоритма Б существенно: норма берётся на НАЧАЛО периода,
    потому что она говорит, сколько человек должен отслужить, и обязана
    быть известна заранее. Обязательство компенсировать возникает, когда
    часы уже отработаны.
    """
    seen: list[date] = []
    subject = case(overtime="20")
    await _service({"overtime": _rule(OVERTIME_RULE)}, seen=seen).allocate(
        case=subject, legal_base="fps_service"
    )
    assert seen == [date(2026, 4, 1)]


# --------------------------------------------------------- шаги 4-7


async def test_the_whole_category_is_compensated() -> None:
    subject = case(overtime="20")
    await _service({"overtime": _rule(OVERTIME_RULE)}).allocate(
        case=subject, legal_base="fps_service"
    )
    line = subject.line_for(HourCategory.OVERTIME)
    assert line is not None
    assert line.hours_amount == Decimal(20)
    assert line.legal_basis_rule_version_id == OVERTIME_RULE


async def test_a_monetary_default_becomes_rest_without_a_rapport() -> None:
    """Приказ № 410 п. 18 и Приказ № 539 п. 103: денежная компенсация
    выплачивается ПО ПРОСЬБЕ сотрудника вместо отдыха.

    Правило, объявившее денежную форму по умолчанию, эту просьбу не
    заменяет: без рапорта остаётся законная форма — дополнительное время
    отдыха (п. 11 Приказа № 410). Спецификация (Алгоритм К шаг 5)
    предписывала обратное; отступление описано в докстринге сервиса.
    """
    subject = case(overtime="20")
    await _service(
        {"overtime": _rule(OVERTIME_RULE, CompensationForm.MONETARY, election_allowed=True)}
    ).allocate(case=subject, legal_base="fps_service")

    line = subject.line_for(HourCategory.OVERTIME)
    assert line is not None
    assert line.compensation_form == CompensationForm.ADDITIONAL_REST_TIME
    assert line.election_allowed is True
    # Рапорта не было — и строка об этом не врёт.
    assert line.employee_election_at is None


async def test_a_rest_default_passes_through_unchanged() -> None:
    """Приведение к отдыху касается только денежной формы: правило,
    назначившее отдых, применяется как есть."""
    subject = case(overtime="20")
    await _service(
        {"overtime": _rule(OVERTIME_RULE, CompensationForm.ADDITIONAL_REST_TIME)}
    ).allocate(case=subject, legal_base="fps_service")

    line = subject.line_for(HourCategory.OVERTIME)
    assert line is not None
    assert line.compensation_form == CompensationForm.ADDITIONAL_REST_TIME


async def test_a_rapport_for_money_is_honoured_with_its_date() -> None:
    """Обратной подмены нет: просьба сотрудника исполняется дословно, и
    дата рапорта сохраняется — Приказ № 410 п. 16 отводит на его передачу
    табельщику три рабочих дня, то есть считает момент существенным."""
    subject = case(overtime="20")
    await _service(
        {"overtime": _rule(OVERTIME_RULE, election_allowed=True)}
    ).allocate(
        case=subject,
        legal_base="fps_service",
        elections={HourCategory.OVERTIME: _elects(CompensationForm.MONETARY)},
    )

    line = subject.line_for(HourCategory.OVERTIME)
    assert line is not None
    assert line.compensation_form == CompensationForm.MONETARY
    assert line.employee_election_at == RAPPORT_AT


async def test_an_election_is_ignored_where_the_rule_forbids_it() -> None:
    """DoD CO007: при `election_allowed=false` форма определяется без
    запроса волеизъявления.

    Рапорт, поданный по такой категории, не меняет форму — и это не
    молчаливое игнорирование: подать его через API невозможно, агрегат
    отвергает `record_election` для строк без права выбора. Здесь
    проверяется, что и прямой вызов сервиса не обойдёт правило.
    """
    subject = case(night="12")
    await _service(
        {"night": _rule(NIGHT_RULE, CompensationForm.ADDITIONAL_REST_TIME)}
    ).allocate(
        case=subject,
        legal_base="fps_service",
        elections={HourCategory.NIGHT: _elects(CompensationForm.MONETARY)},
    )

    line = subject.line_for(HourCategory.NIGHT)
    assert line is not None
    assert line.compensation_form == CompensationForm.ADDITIONAL_REST_TIME
    assert line.election_allowed is False
    assert line.employee_election_at is None


async def test_categories_may_have_different_forms_and_rules() -> None:
    """Ночные — отдыхом по правилу, сверхурочные — деньгами по рапорту
    сотрудника. Разные категории компенсируются независимо, и каждая
    ссылается на СВОЮ версию правила."""
    subject = case(night="12", overtime="20")
    await _service(
        {
            "night": _rule(NIGHT_RULE),
            "overtime": _rule(OVERTIME_RULE, election_allowed=True),
        }
    ).allocate(
        case=subject,
        legal_base="fps_service",
        elections={HourCategory.OVERTIME: _elects(CompensationForm.MONETARY)},
    )

    night = subject.line_for(HourCategory.NIGHT)
    overtime = subject.line_for(HourCategory.OVERTIME)
    assert night is not None and overtime is not None
    assert night.compensation_form == CompensationForm.ADDITIONAL_REST_TIME
    assert overtime.compensation_form == CompensationForm.MONETARY
    assert night.legal_basis_rule_version_id != overtime.legal_basis_rule_version_id


# ------------------------------------------------------------ шаг 8


async def test_allocation_never_exceeds_the_fact() -> None:
    """Шаг 8 выполняется агрегатом при каждом `add_line`, поэтому здесь
    достаточно убедиться, что распределение берёт РОВНО зафиксированные
    часы, а не какую-то производную от них."""
    subject = case(holiday="16")
    await _service({"holiday": _rule(uuid4())}).allocate(
        case=subject, legal_base="fps_service"
    )
    assert subject.hours_allocated_to(HourCategory.HOLIDAY) == Decimal(16)
    assert subject.compensable is not None
    assert (
        subject.hours_allocated_to(HourCategory.HOLIDAY)
        == subject.compensable.holiday_hours
    )


async def test_a_case_without_limits_cannot_be_allocated() -> None:
    """Дело, загруженное из БД без восстановленного предела: распределять
    нечего, и молча посчитать «сколько-нибудь» нельзя."""
    subject = case(overtime="20")
    subject.compensable = None
    with pytest.raises(ValueError, match="распределять нечего"):
        await _service({}).allocate(case=subject, legal_base="fps_service")
