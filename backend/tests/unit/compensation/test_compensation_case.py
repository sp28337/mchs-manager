"""CO002 — инварианты агрегата `CompensationCase` (Domain Model разд. 7.1).

Главный из них — 7.1.2: «сумма часов компенсации по категории не может
превышать соответствующее значение `HoursBreakdown`». Формулировка
документа объясняет, зачем он: «компенсация не может „придумывать" часы
сверх зафиксированного факта». Это граница между начислением и выдумкой,
и проверяется она здесь подробнее остальных.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import uuid4

import pytest

from src.modules.compensation.domain.compensation_case import CompensationCase
from src.modules.compensation.domain.errors import (
    CaseFinalizedError,
    CompensationExceedsFactError,
    ElectionNotApplicableError,
    EmptyCompensationCaseError,
)
from src.modules.compensation.domain.events import (
    CompensationCaseFinalized,
    CompensationLineCreated,
)
from src.modules.compensation.domain.value_objects import (
    AccountingPeriod,
    CaseStatus,
    CompensableHours,
    CompensationForm,
    EmployeeElection,
    HourCategory,
)

RULE_VERSION = uuid4()


def march_2026() -> AccountingPeriod:
    return AccountingPeriod(start=date(2026, 3, 1), end=date(2026, 4, 1))


def breakdown(
    *,
    night: str = "0",
    holiday: str = "0",
    weekend: str = "0",
    overtime: str = "0",
) -> CompensableHours:
    return CompensableHours(
        night_hours=Decimal(night),
        holiday_hours=Decimal(holiday),
        weekend_hours=Decimal(weekend),
        overtime_hours=Decimal(overtime),
    )


def case(compensable: CompensableHours | None = None) -> CompensationCase:
    return CompensationCase.open_for(
        employee_id=uuid4(),
        timesheet_id=uuid4(),
        period=march_2026(),
        compensable=compensable or breakdown(night="12", overtime="20"),
    )


def _add(
    subject: CompensationCase,
    category: HourCategory,
    hours: str,
    *,
    form: CompensationForm = CompensationForm.MONETARY,
    election_allowed: bool = False,
) -> None:
    subject.add_line(
        hour_category=category,
        hours_amount=Decimal(hours),
        compensation_form=form,
        legal_basis_rule_version_id=RULE_VERSION,
        election_allowed=election_allowed,
    )


# ------------------------------------------------------- инвариант 7.1.2


def test_hours_within_the_fact_are_allocated() -> None:
    subject = case()
    _add(subject, HourCategory.OVERTIME, "20")
    assert subject.hours_allocated_to(HourCategory.OVERTIME) == Decimal(20)


def test_hours_exceeding_the_fact_are_refused() -> None:
    """DoD CO002: явный тест на превышение суммы по категории overtime."""
    subject = case(breakdown(overtime="20"))
    with pytest.raises(CompensationExceedsFactError):
        _add(subject, HourCategory.OVERTIME, "20.01")
    assert subject.lines == []


def test_two_lines_summing_over_the_fact_are_refused() -> None:
    """Самый опасный случай: каждая строка по отдельности в пределах
    факта, а в сумме — сверх него. Ровно то задвоение, ради запрета
    которого инвариант написан."""
    subject = case(breakdown(overtime="20"))
    _add(subject, HourCategory.OVERTIME, "15")
    with pytest.raises(CompensationExceedsFactError):
        _add(subject, HourCategory.OVERTIME, "10")
    assert subject.hours_allocated_to(HourCategory.OVERTIME) == Decimal(15)


def test_categories_are_limited_independently() -> None:
    """Предел у каждой категории свой: 20 ч переработки не позволяют
    начислить 20 ч ночных."""
    subject = case(breakdown(night="12", overtime="20"))
    _add(subject, HourCategory.OVERTIME, "20")
    with pytest.raises(CompensationExceedsFactError):
        _add(subject, HourCategory.NIGHT, "20")
    _add(subject, HourCategory.NIGHT, "12")
    assert subject.hours_allocated_to(HourCategory.NIGHT) == Decimal(12)


def test_a_category_absent_from_the_breakdown_cannot_be_compensated() -> None:
    """Праздничных часов в периоде не было — начислить за них нечего."""
    subject = case(breakdown(overtime="20"))
    with pytest.raises(CompensationExceedsFactError):
        _add(subject, HourCategory.HOLIDAY, "1")


def test_exactly_the_fact_is_allowed() -> None:
    """Предел — это предел, а не запрет: ровно зафиксированные часы
    компенсируются полностью."""
    subject = case(breakdown(holiday="16"))
    _add(subject, HourCategory.HOLIDAY, "16")
    assert subject.hours_allocated_to(HourCategory.HOLIDAY) == Decimal(16)


def test_a_zero_hour_line_is_refused() -> None:
    subject = case()
    with pytest.raises(ValueError, match="не имеет смысла"):
        _add(subject, HourCategory.OVERTIME, "0")


def test_only_non_empty_categories_are_offered_for_compensation() -> None:
    """Алгоритм К шаг 2: «для каждой НЕПУСТОЙ категории часов»."""
    compensable = breakdown(night="12", overtime="20")
    assert compensable.non_empty_categories() == [HourCategory.NIGHT, HourCategory.OVERTIME]


# ------------------------------------------------------- инвариант 7.1.3


def test_an_election_is_recorded_where_the_rule_allows_it() -> None:
    subject = case()
    _add(subject, HourCategory.OVERTIME, "20", election_allowed=True)

    line = subject.record_election(
        hour_category=HourCategory.OVERTIME,
        election=EmployeeElection(
            form=CompensationForm.ADDITIONAL_REST_TIME,
            elected_at=datetime(2026, 4, 5, 10, tzinfo=UTC),
        ),
    )
    assert line.compensation_form == CompensationForm.ADDITIONAL_REST_TIME
    assert line.employee_election_at is not None


def test_an_election_is_refused_where_the_rule_decides_the_form() -> None:
    """ТК РФ ст. 152/153 дают выбор работнику, но не по всякой категории:
    применимость выбора — атрибут действующего правила, а не жёстко
    закодированное условие (инвариант 7.1.3)."""
    subject = case()
    _add(subject, HourCategory.NIGHT, "12", election_allowed=False)

    with pytest.raises(ElectionNotApplicableError):
        subject.record_election(
            hour_category=HourCategory.NIGHT,
            election=EmployeeElection(
                form=CompensationForm.ADDITIONAL_REST_TIME,
                elected_at=datetime(2026, 4, 5, 10, tzinfo=UTC),
            ),
        )


def test_an_election_for_a_category_without_a_line_is_refused() -> None:
    subject = case()
    with pytest.raises(ElectionNotApplicableError):
        subject.record_election(
            hour_category=HourCategory.WEEKEND,
            election=EmployeeElection(
                form=CompensationForm.MONETARY,
                elected_at=datetime(2026, 4, 5, 10, tzinfo=UTC),
            ),
        )


def test_a_naive_election_timestamp_is_refused() -> None:
    with pytest.raises(ValueError, match="таймзоной"):
        EmployeeElection(
            form=CompensationForm.MONETARY, elected_at=datetime(2026, 4, 5, 10)
        )


# ------------------------------------------------------- инвариант 7.1.4


def test_a_finalized_case_refuses_new_lines() -> None:
    subject = case()
    _add(subject, HourCategory.OVERTIME, "20")
    subject.finalize()

    with pytest.raises(CaseFinalizedError):
        _add(subject, HourCategory.NIGHT, "12")


def test_a_finalized_case_refuses_an_election() -> None:
    """Волеизъявление после финализации отклоняется (DoD CO008): выбор
    формы влияет на то, что уже начислено."""
    subject = case()
    _add(subject, HourCategory.OVERTIME, "20", election_allowed=True)
    subject.finalize()

    with pytest.raises(CaseFinalizedError):
        subject.record_election(
            hour_category=HourCategory.OVERTIME,
            election=EmployeeElection(
                form=CompensationForm.MONETARY,
                elected_at=datetime(2026, 4, 5, 10, tzinfo=UTC),
            ),
        )


def test_finalizing_twice_is_refused() -> None:
    subject = case()
    _add(subject, HourCategory.OVERTIME, "20")
    subject.finalize()
    with pytest.raises(CaseFinalizedError):
        subject.finalize()


def test_an_empty_case_cannot_be_finalized() -> None:
    with pytest.raises(EmptyCompensationCaseError):
        case().finalize()


def test_the_period_of_a_case_cannot_be_changed() -> None:
    subject = case()
    with pytest.raises(CaseFinalizedError):
        subject.period = AccountingPeriod(start=date(2026, 4, 1), end=date(2026, 5, 1))


def test_a_correction_references_the_case_it_fixes() -> None:
    subject = case()
    _add(subject, HourCategory.OVERTIME, "20")
    subject.finalize()

    correction = subject.open_correction(compensable=breakdown(overtime="18"))

    assert correction.corrects_case_id == subject.id
    assert correction.status == CaseStatus.DRAFT
    assert correction.employee_id == subject.employee_id
    assert correction.period == subject.period
    # Строки НЕ копируются: исправляется именно начисление, и копия
    # неверных строк была бы предложением их не заметить.
    assert correction.lines == []
    # Предел у корректировки — пересчитанный, а не прежний.
    assert correction.compensable.overtime_hours == Decimal(18)


def test_a_draft_case_cannot_be_corrected() -> None:
    """Черновик правится на месте — заводить для этого второе дело значило
    бы плодить пустые записи."""
    with pytest.raises(CaseFinalizedError):
        case().open_correction(compensable=breakdown(overtime="18"))


# ----------------------------------------------------------- события


def test_finalizing_raises_an_event_per_line_plus_one_for_the_case() -> None:
    """DoD CO009: финализация публикует `CompensationLineCreated` для
    каждой строки."""
    subject = case(breakdown(night="12", overtime="20"))
    _add(subject, HourCategory.OVERTIME, "20")
    _add(
        subject,
        HourCategory.NIGHT,
        "12",
        form=CompensationForm.ADDITIONAL_REST_TIME,
    )
    subject.finalize()

    events = subject.pull_pending_events()
    line_events = [e for e in events if isinstance(e, CompensationLineCreated)]
    case_events = [e for e in events if isinstance(e, CompensationCaseFinalized)]

    assert len(line_events) == 2
    assert len(case_events) == 1
    assert case_events[0].line_count == 2

    # Событие несёт форму: `rest_balance` начисляет сутки отдыха только по
    # строкам `additional_rest_time`, и решить это он должен сам, не
    # спрашивая обратно.
    rest_lines = [
        e for e in line_events if e.compensation_form == CompensationForm.ADDITIONAL_REST_TIME
    ]
    assert len(rest_lines) == 1
    assert rest_lines[0].hour_category == HourCategory.NIGHT
    assert rest_lines[0].legal_basis_rule_version_id == RULE_VERSION


def test_a_draft_case_raises_nothing() -> None:
    subject = case()
    _add(subject, HourCategory.OVERTIME, "20")
    assert subject.pull_pending_events() == []
