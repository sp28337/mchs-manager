"""`CompensationCase` — агрегат-корень дела о компенсации (Domain Model
разд. 7.1).

Граница агрегата: один `employee_id` + один учётный период, вместе со
всеми строками начисления. Создаётся только после закрытия
соответствующего `Timesheet`.

--- Где какой инвариант живёт ------------------------------------------

* **7.1.1, только по утверждённому табелю** — НЕ здесь. Статус табеля
  живёт в `time_accounting`, куда этот модуль ходит только через
  `Contracts` (Architecture разд. 4.2). Проверяет обработчик.
* **7.1.2, часы компенсации ≤ HoursBreakdown** — ЗДЕСЬ, и это главный
  инвариант модуля. Утверждённый `HoursBreakdown` передаётся в агрегат
  при создании и хранится как `compensable`: агрегат обязан быть тем, кто
  отказывает, а для этого ему нужен предел под рукой, а не по запросу.
* **7.1.3, выбор формы только где правило его допускает** — здесь
  частично: агрегат знает, разрешён ли выбор для строки (`election_allowed`
  приходит из `RuleVersion`), и отказывает в записи волеизъявления там,
  где он не разрешён. Само значение признака — данные, а не код.
* **7.1.4, финализированное дело неизменяемо** — здесь, целиком.

--- Почему предел хранится в агрегате, а не проверяется снаружи --------

`compensable` — это не «кэш чужих данных», а часть состояния дела на
момент его создания. `HoursBreakdown` утверждённого табеля неизменен
(инвариант 6.1.4), поэтому копия не может устареть, пока табель не
переоткрыт; а если он переоткрыт и пересчитан — это другой факт, и дело
по нему оформляется корректировкой, а не правкой существующего.

Хранить предел снаружи и передавать в каждый вызов значило бы, что
агрегат можно попросить нарушить собственный инвариант, просто передав
другое число.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from src.building_blocks.domain.aggregate_root import AggregateRoot
from src.building_blocks.domain.entity import Entity
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


@dataclass(eq=False, kw_only=True)
class CompensationLine(Entity):
    """{категория часов, количество, форма, ссылка на RuleVersion} —
    Domain Model разд. 7.1."""

    case_id: UUID
    hour_category: HourCategory
    hours_amount: Decimal
    compensation_form: CompensationForm
    legal_basis_rule_version_id: UUID
    employee_election_at: datetime | None = None
    # Допускает ли действующая `RuleVersion` выбор формы сотрудником
    # (Алгоритм К шаг 4). Не хранится в БД: это свойство ПРАВИЛА, а не
    # строки, и восстанавливается из той же версии, на которую строка
    # ссылается. Дублировать его в таблицу значило бы завести второй
    # источник истины о содержании нормативного акта.
    election_allowed: bool = False

    def __post_init__(self) -> None:
        if self.hours_amount <= 0:
            # Зеркало `ck_compensation_line_hours_positive`. Категория без
            # часов не порождает строки вовсе (Алгоритм К шаг 2).
            raise ValueError(
                f"строка компенсации по категории {self.hour_category} на "
                f"{self.hours_amount} ч не имеет смысла: компенсируются только "
                f"фактически отработанные часы"
            )


@dataclass(eq=False, kw_only=True)
class CompensationCase(AggregateRoot):
    employee_id: UUID
    timesheet_id: UUID
    period: AccountingPeriod
    compensable: CompensableHours
    status: CaseStatus = CaseStatus.DRAFT
    corrects_case_id: UUID | None = None
    finalized_at: datetime | None = None
    lines: list[CompensationLine] = field(default_factory=list)

    @classmethod
    def open_for(
        cls,
        *,
        employee_id: UUID,
        timesheet_id: UUID,
        period: AccountingPeriod,
        compensable: CompensableHours,
        corrects_case_id: UUID | None = None,
    ) -> CompensationCase:
        """CO005. Дело рождается черновиком и пустым.

        Строки добавляет Алгоритм К — по одной на каждую непустую
        категорию, — и делает это отдельным шагом: заведение дела и
        расчёт начисления разделены, потому что первое следует из факта
        утверждения табеля, а второе требует действующих коэффициентов и
        может отказать.
        """
        return cls(
            id=uuid4(),
            employee_id=employee_id,
            timesheet_id=timesheet_id,
            period=period,
            compensable=compensable,
            status=CaseStatus.DRAFT,
            corrects_case_id=corrects_case_id,
            lines=[],
        )

    def __setattr__(self, name: str, value: Any) -> None:
        # Зеркало `trg_compensation_case_immutability` (миграция 0017).
        # Короткое замыкание через `getattr(..., None)` — по той же
        # причине, что во всех агрегатах кодовой базы: инструментация
        # SQLAlchemy пишет служебные маркеры до появления состояния.
        if name in {"employee_id", "timesheet_id", "period"}:
            current = getattr(self, name, None)
            if current is not None and current != value:
                raise CaseFinalizedError(
                    f"{name} дела о компенсации неизменяем после создания"
                )
        super().__setattr__(name, value)

    # ------------------------------------------------------------ строки

    def add_line(
        self,
        *,
        hour_category: HourCategory,
        hours_amount: Decimal,
        compensation_form: CompensationForm,
        legal_basis_rule_version_id: UUID,
        election_allowed: bool = False,
    ) -> CompensationLine:
        """Алгоритм К шаг 7 плюс проверка инварианта 7.1.2 (шаг 8)."""
        self._require_draft("добавить строку в")

        available = self.compensable.of(hour_category)
        already = self.hours_allocated_to(hour_category)
        if already + hours_amount > available:
            raise CompensationExceedsFactError(
                f"компенсация по категории {hour_category}: запрошено "
                f"{already + hours_amount} ч при зафиксированном факте {available} ч "
                f"(Domain Model инвариант 7.1.2 — компенсация не может «придумывать» "
                f"часы сверх утверждённого HoursBreakdown)"
            )

        line = CompensationLine(
            id=uuid4(),
            case_id=self.id,
            hour_category=hour_category,
            hours_amount=hours_amount,
            compensation_form=compensation_form,
            legal_basis_rule_version_id=legal_basis_rule_version_id,
            election_allowed=election_allowed,
        )
        self.lines.append(line)
        return line

    def hours_allocated_to(self, category: HourCategory) -> Decimal:
        return sum(
            (line.hours_amount for line in self.lines if line.hour_category == category),
            Decimal(0),
        )

    def line_for(self, category: HourCategory) -> CompensationLine | None:
        for line in self.lines:
            if line.hour_category == category:
                return line
        return None

    # ---------------------------------------------------- волеизъявление

    def record_election(
        self, *, hour_category: HourCategory, election: EmployeeElection
    ) -> CompensationLine:
        """CO008. Сотрудник выбрал форму компенсации по категории.

        ТК РФ ст. 152/153 и ФЗ-141 ст. 55 дают этот выбор работнику, но
        не по всякой категории: применимость выбора — атрибут действующей
        `RuleVersion` (инвариант 7.1.3), и там, где правило определяет
        форму однозначно, рапорт принимать нельзя — иначе система
        сделала бы вид, что выбор был, а закон его не давал.
        """
        self._require_draft("записать волеизъявление в")

        line = self.line_for(hour_category)
        if line is None:
            raise ElectionNotApplicableError(
                f"в деле {self.id} нет строки по категории {hour_category}: "
                f"выбирать форму не для чего"
            )
        if not line.election_allowed:
            raise ElectionNotApplicableError(
                f"действующее правило не допускает выбор формы компенсации по "
                f"категории {hour_category}: форма определена однозначно "
                f"(Domain Model инвариант 7.1.3)"
            )

        line.compensation_form = election.form
        line.employee_election_at = election.elected_at
        return line

    # ------------------------------------------------------- финализация

    def finalize(self, *, now: datetime | None = None) -> None:
        """CO009. Алгоритм К шаг 9.

        После этого дело неизменяемо: начисление произошло — деньги
        выплачены или сутки зачтены в баланс ДДО, — и отменить его задним
        числом нельзя. Исправление оформляется новым делом-корректировкой
        (`open_correction`).
        """
        self._require_draft("финализировать")

        if not self.lines:
            raise EmptyCompensationCaseError(
                f"дело {self.id} не содержит ни одной строки: «компенсация определена "
                f"окончательно и равна ничему» неотличимо от «расчёт не выполнялся»"
            )

        self.finalized_at = now or datetime.now(UTC)
        self.status = CaseStatus.FINALIZED

        # Событие на КАЖДУЮ строку (DoD CO009), а не одно на дело:
        # подписчик — `rest_balance`, и начисляет он сутки отдыха ровно по
        # тем строкам, где выбрана форма `additional_rest_time`. Одно
        # событие со списком заставило бы его разбирать чужую структуру и
        # решать, какие строки его касаются.
        for line in self.lines:
            self.raise_event(
                CompensationLineCreated(
                    case_id=self.id,
                    line_id=line.id,
                    employee_id=self.employee_id,
                    hour_category=line.hour_category,
                    hours_amount=line.hours_amount,
                    compensation_form=line.compensation_form,
                    legal_basis_rule_version_id=line.legal_basis_rule_version_id,
                    period_start=self.period.start,
                    period_end=self.period.end,
                )
            )

        self.raise_event(
            CompensationCaseFinalized(
                case_id=self.id,
                employee_id=self.employee_id,
                timesheet_id=self.timesheet_id,
                period_start=self.period.start,
                period_end=self.period.end,
                line_count=len(self.lines),
            )
        )

    def open_correction(self, *, compensable: CompensableHours) -> CompensationCase:
        """Инвариант 7.1.4: «исправление возможно только новым
        `CompensationCase`-корректировкой, ссылающейся на предыдущее дело».

        Корректировать можно только финализированное дело: черновик просто
        правится на месте, и заводить для этого второе дело значило бы
        плодить пустые записи.

        Строки НЕ копируются, в отличие от пересмотра графика: там
        пересматривается план, и большая часть смен остаётся прежней, а
        здесь исправляется НАЧИСЛЕНИЕ — то есть ровно то, что оказалось
        неверным. Копия неверных строк была бы предложением их не заметить.
        """
        if self.status != CaseStatus.FINALIZED:
            raise CaseFinalizedError(
                f"корректировать можно только финализированное дело; {self.id} "
                f"в статусе {self.status}"
            )

        return CompensationCase(
            id=uuid4(),
            employee_id=self.employee_id,
            timesheet_id=self.timesheet_id,
            period=self.period,
            compensable=compensable,
            status=CaseStatus.DRAFT,
            corrects_case_id=self.id,
            lines=[],
        )

    @property
    def is_editable(self) -> bool:
        return self.status == CaseStatus.DRAFT

    def _require_draft(self, action: str) -> None:
        if not self.is_editable:
            raise CaseFinalizedError(
                f"дело {self.id} финализировано — нельзя {action} него; исправление "
                f"оформляется новым делом-корректировкой "
                f"(Domain Model инвариант 7.1.4)"
            )
