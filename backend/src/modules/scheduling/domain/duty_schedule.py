"""`DutySchedule` — агрегат-корень графика дежурств (Domain Model разд. 5.1).

Граница агрегата: один `unit_id` + один учётный период, вместе со всеми
плановыми сменами этого периода. Смены — дочерние сущности: снаружи к
`PlannedShift` никто не обращается иначе как через её график.

--- Где какой инвариант живёт, и почему именно там ---------------------

Инварианты 5.1 распределены между тремя уровнями не по вкусу, а по тому,
что каждый уровень физически в состоянии увидеть:

* **5.1.1, непересечение смен** — здесь И в БД. Агрегат видит только свои
  смены, поэтому ловит пересечение внутри периода; `excl_planned_shift_no_overlap`
  (миграция 0012) глобален по сотруднику и ловит в том числе пересечение
  через границу двух графиков, которого агрегат увидеть не может.
  Дублирование намеренное: агрегат обязан быть тем, кто отказывает, а не
  только SQL (Domain Model разд. 0).
* **5.1.2, минимальный межсменный отдых** — НЕ здесь. Требует соседнего
  графика и `RuleVersion` категории `minimum_rest_period`, то есть двух
  вещей за границей агрегата. Живёт в `RestPeriodPolicyService` (SD006).
* **5.1.3, неизменяемость после утверждения** — здесь, целиком.
* **5.1.4, только активный сотрудник** — НЕ здесь. Статус сотрудника
  живёт в `personnel`, куда этот модуль может обратиться только через
  `Contracts` (Architecture разд. 4.2), а агрегат не ходит наружу вовсе.
  Проверяет обработчик, до вызова доменного метода.

Правило простое: агрегат отказывает во всём, о чём может судить сам, и ни
в чём другом. Всё, что требует взгляда наружу, поднимается на уровень,
который этот взгляд имеет.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID, uuid4

from src.building_blocks.domain.aggregate_root import AggregateRoot
from src.building_blocks.domain.entity import Entity
from src.building_blocks.domain.time_interval import TimeInterval
from src.modules.scheduling.domain.errors import (
    OverlappingShiftError,
    ScheduleApprovedError,
    ShiftOutsideSchedulePeriodError,
)
from src.modules.scheduling.domain.events import ScheduleApproved, ScheduleRevised
from src.modules.scheduling.domain.value_objects import (
    AccountingPeriod,
    DutyType,
    ScheduleStatus,
)


@dataclass(eq=False, kw_only=True)
class PlannedShift(Entity):
    """{EmployeeId, TimeInterval, DutyType} — Domain Model разд. 5.1."""

    duty_schedule_id: UUID
    employee_id: UUID
    time_range: TimeInterval
    duty_type: DutyType
    # Смена отменённой версии графика. Не удаляется — по действовавшему на
    # тот момент приказу она существовала, — но перестаёт занимать время
    # сотрудника: `excl_planned_shift_no_overlap` частичный
    # (`WHERE NOT superseded`, миграция 0013).
    superseded: bool = False

    def overlaps(self, other: PlannedShift) -> bool:
        """Пересечение считается только между сменами ОДНОГО сотрудника:
        две смены разных людей в одно время — это норма, а не конфликт.
        Отменённые смены не участвуют: они уже не несутся."""
        if self.superseded or other.superseded:
            return False
        return self.employee_id == other.employee_id and self.time_range.overlaps(other.time_range)


@dataclass(eq=False, kw_only=True)
class DutySchedule(AggregateRoot):
    unit_id: UUID
    period: AccountingPeriod
    status: ScheduleStatus = ScheduleStatus.DRAFT
    approval_order_ref: str | None = None
    revision_no: int = 1
    previous_schedule_id: UUID | None = None
    revision_reason: str | None = None
    shifts: list[PlannedShift] = field(default_factory=list)

    @classmethod
    def draft(cls, *, unit_id: UUID, period: AccountingPeriod) -> DutySchedule:
        """SD004. График всегда рождается черновиком: утверждение — это
        отдельное действие с приказом-основанием, а не свойство создания."""
        return cls(
            id=uuid4(),
            unit_id=unit_id,
            period=period,
            status=ScheduleStatus.DRAFT,
            approval_order_ref=None,
            shifts=[],
        )

    def __setattr__(self, name: str, value: Any) -> None:
        # Зеркало `ck_duty_schedule_approved_has_order` (миграция 0012):
        # статус `approved` без приказа непредставим. Короткое замыкание
        # до `getattr` — по той же причине, что в `legal_rules.RuleVersion`:
        # инструментация SQLAlchemy пишет свой служебный маркер через этот
        # же `__setattr__` до того, как у объекта появится состояние.
        if name == "status" and value == ScheduleStatus.APPROVED:
            if getattr(self, "approval_order_ref", None) is None:
                raise ScheduleApprovedError(
                    "график нельзя перевести в approved без approval_order_ref"
                )
        super().__setattr__(name, value)

    # ------------------------------------------------------------- смены

    def add_shift(
        self, *, employee_id: UUID, time_range: TimeInterval, duty_type: DutyType
    ) -> PlannedShift:
        """SD005. Инварианты 5.1.1 и «смена начинается внутри периода»."""
        self._require_draft("добавить смену в")

        if not self.period.contains(time_range.start.date()):
            raise ShiftOutsideSchedulePeriodError(
                f"смена начинается {time_range.start.date()}, а период графика — "
                f"[{self.period.start}, {self.period.end})"
            )

        candidate = PlannedShift(
            id=uuid4(),
            duty_schedule_id=self.id,
            employee_id=employee_id,
            time_range=time_range,
            duty_type=duty_type,
        )
        for existing in self.shifts:
            if existing.overlaps(candidate):
                raise OverlappingShiftError(
                    f"смена сотрудника {employee_id} "
                    f"[{time_range.start}, {time_range.end}) пересекается со сменой "
                    f"{existing.id} [{existing.time_range.start}, {existing.time_range.end})"
                )

        self.shifts.append(candidate)
        return candidate

    def shifts_of(self, employee_id: UUID) -> list[PlannedShift]:
        """Смены одного сотрудника, по возрастанию начала — форма, в
        которой их читает `RestPeriodPolicyService` (SD006)."""
        return sorted(
            (s for s in self.shifts if s.employee_id == employee_id),
            key=lambda s: s.time_range.start,
        )

    # -------------------------------------------------------- утверждение

    def approve(self, *, approval_order_ref: str) -> None:
        """SD008. После этого график неизменяем (инвариант 5.1.3)."""
        self._require_draft("утвердить")

        if not approval_order_ref.strip():
            raise ScheduleApprovedError("approval_order_ref не может быть пустым")

        # Порядок важен: `status` проверяется в `__setattr__` против уже
        # присвоенного `approval_order_ref`, поэтому приказ ставится первым.
        self.approval_order_ref = approval_order_ref
        self.status = ScheduleStatus.APPROVED

        self.raise_event(
            ScheduleApproved(
                duty_schedule_id=self.id,
                unit_id=self.unit_id,
                period_start=self.period.start,
                period_end=self.period.end,
                approval_order_ref=approval_order_ref,
            )
        )

    def revise(self, *, reason: str) -> DutySchedule:
        """SD009 — пересмотр утверждённого графика.

        График утверждается приказом, поэтому изменить утверждённый можно
        только новым приказом: метод возвращает НОВУЮ версию в статусе
        `draft`, а текущую закрывает. Правка на месте означала бы, что
        документ, по которому люди уже несли службу, задним числом стал
        другим (Domain Model разд. 13, SRS разд. 10 п. 1).

        Смены переносятся в новую версию копиями, а оригиналы помечаются
        `superseded`: пересмотр почти всегда меняет часть состава, и
        начинать с пустого графика значило бы заставить табельщика ввести
        заново то, что не менялось. Оригиналы остаются историей —
        записями о том, кто должен был нести службу по прежнему приказу.

        Пересматривать можно только утверждённый график: черновик просто
        редактируется, а закрытый уже пересмотрен — у него есть преемник,
        и вторая ветка версий сделала бы «действующую версию»
        неоднозначной.
        """
        if self.status != ScheduleStatus.APPROVED:
            raise ScheduleApprovedError(
                f"пересмотреть можно только утверждённый график; {self.id} в статусе "
                f"{self.status}"
            )
        if not reason.strip():
            raise ScheduleApprovedError("причина пересмотра обязательна (Domain Model 5.1.3)")

        successor = DutySchedule(
            id=uuid4(),
            unit_id=self.unit_id,
            period=self.period,
            status=ScheduleStatus.DRAFT,
            approval_order_ref=None,
            revision_no=self.revision_no + 1,
            previous_schedule_id=self.id,
            revision_reason=reason,
            shifts=[],
        )
        for shift in self.shifts:
            successor.shifts.append(
                PlannedShift(
                    id=uuid4(),
                    duty_schedule_id=successor.id,
                    employee_id=shift.employee_id,
                    time_range=shift.time_range,
                    duty_type=shift.duty_type,
                )
            )
            shift.superseded = True

        self.status = ScheduleStatus.CLOSED

        self.raise_event(
            ScheduleRevised(
                duty_schedule_id=self.id,
                successor_schedule_id=successor.id,
                unit_id=self.unit_id,
                revision_no=successor.revision_no,
                reason=reason,
            )
        )
        return successor

    @property
    def is_editable(self) -> bool:
        return self.status == ScheduleStatus.DRAFT

    def _require_draft(self, action: str) -> None:
        if self.status != ScheduleStatus.DRAFT:
            raise ScheduleApprovedError(
                f"график {self.id} в статусе {self.status} — нельзя {action} него; "
                f"изменение утверждённого графика возможно только через пересмотр "
                f"(Domain Model инвариант 5.1.3)"
            )
