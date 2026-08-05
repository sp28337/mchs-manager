"""`Timesheet` — агрегат-корень табеля (Domain Model разд. 6.1).

«Центральный агрегат всей модели». Граница: один `employee_id` + один
учётный период, вместе со всеми фактами этого периода и всеми
исправлениями к ним.

--- Где какой инвариант живёт ------------------------------------------

* **6.1.1, непересечение событий** — здесь И в БД
  (`excl_service_time_event_no_overlap`). Агрегат видит только свои
  события, но их ему и достаточно: инвариант сформулирован «внутри одного
  Timesheet».
* **6.1.2, привлечение сверх нормы требует приказа** — здесь. Агрегат
  проверяет НАЛИЧИЕ ссылки, но не существование самого приказа: приказ —
  отдельный агрегат (`OvertimeOrder`), и ссылочную целостность держит
  внешний ключ в БД, а не обход агрегатов в памяти.
* **6.1.3, болезнь/отстранение не вменяются как недоработка** — не здесь
  вовсе. Это правило РАСЧЁТА (Алгоритм З шаг 5), а не правило записи
  факта; агрегат лишь хранит тип события, по которому расчёт их отличит.
* **6.1.4, неизменяемость после утверждения** — здесь, целиком.
* **6.1.5, детерминированность расчёта** — не здесь. Свойство функции
  расчёта, а не состояния агрегата.
* **6.1.6, ≤ 24 ч за сутки** — НЕ здесь, и это не упущение. Внутри одного
  табеля инвариант выполняется автоматически: события не пересекаются
  (6.1.1), а непересекающиеся интервалы не могут дать за одни сутки
  больше 24 ч ни в каком часовом поясе. Содержание у 6.1.6 появляется
  только на стыке ДВУХ табелей одного сотрудника, куда агрегат не
  дотягивается, — поэтому проверка живёт в `DailyServiceTimeLimitService`,
  а в БД её роль исполняет глобальный `excl_actual_shift_employee_no_overlap`
  (см. п. 1 докстринга миграции 0014).

Правило то же, что в `scheduling.DutySchedule`: агрегат отказывает во
всём, о чём может судить сам, и ни в чём другом.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from src.building_blocks.domain.aggregate_root import AggregateRoot
from src.building_blocks.domain.entity import Entity
from src.building_blocks.domain.time_interval import TimeInterval
from src.modules.time_accounting.domain.errors import (
    BusinessTripWithoutPlaceError,
    CorrectionTargetNotFoundError,
    EventOutsideTimesheetPeriodError,
    OverlappingServiceTimeEventError,
    OvertimeWithoutOrderError,
    TimesheetApprovedError,
    TimesheetReopenError,
)
from src.modules.time_accounting.domain.events import (
    OvertimeAttracted,
    ShiftActuallyPerformed,
    SicknessRegistered,
    TimesheetApproved,
    TimesheetReopened,
)
from src.modules.time_accounting.domain.value_objects import (
    AccountingPeriod,
    ServiceTimeEventType,
    TimesheetStatus,
)

_MINIMUM_REASON_LENGTH = 10


@dataclass(eq=False, kw_only=True)
class ServiceTimeEvent(Entity):
    """Типизированная запись факта (Domain Model разд. 6.1).

    Domain Model описывает `ServiceTimeEvent` как «абстрактный тип с
    вариантами» (`ActualShiftRecord`, `SicknessRecord`, ...). Здесь это
    ОДНА сущность с полем `event_type`, а не иерархия из пяти классов, и
    это сознательный выбор, а не упрощение:

    * в БД это одна таблица с одним enum-столбцом (логическая модель
      разд. 5.4) — иерархия классов потребовала бы либо полиморфного
      маппинга поверх той же таблицы, либо расхождения модели и схемы;
    * openapi описывает вход одной схемой `ServiceTimeEventRequest` с
      `discriminator: eventType` — то есть внешняя граница тоже одна;
    * различия между вариантами исчерпываются тем, какие необязательные
      поля обязательны, а это правило, а не структура.

    Правило и проверяется здесь же, в одном месте, вместо того чтобы быть
    размазанным по конструкторам пяти подклассов.
    """

    timesheet_id: UUID
    employee_id: UUID
    event_type: ServiceTimeEventType
    time_range: TimeInterval
    planned_shift_id: UUID | None = None
    overtime_order_id: UUID | None = None
    business_trip_place: str | None = None

    def __post_init__(self) -> None:
        # Зеркала CHECK-ограничений миграции 0014. Проверяются в домене,
        # а не только в БД, потому что отказывать обязан домен (Domain
        # Model разд. 0), а БД — последний рубеж, а не единственный.
        if self.event_type is ServiceTimeEventType.OVERTIME_ATTRACTION:
            if self.overtime_order_id is None:
                raise OvertimeWithoutOrderError(
                    "привлечение сверх нормы невозможно без приказа-основания "
                    "(Domain Model инвариант 6.1.2, SRS разд. 8)"
                )
        elif self.overtime_order_id is not None:
            raise OvertimeWithoutOrderError(
                f"приказ на привлечение сверх нормы не имеет смысла на событии типа "
                f"{self.event_type}: он обосновывает именно привлечение"
            )

        if self.event_type is ServiceTimeEventType.BUSINESS_TRIP and not (
            self.business_trip_place or ""
        ).strip():
            raise BusinessTripWithoutPlaceError(
                "командировка без места назначения не является командировкой"
            )

    def overlaps(self, other: ServiceTimeEvent) -> bool:
        return self.time_range.overlaps(other.time_range)

    @property
    def counts_as_service_time(self) -> bool:
        return self.event_type.counts_as_service_time

    @property
    def is_explained_absence(self) -> bool:
        return self.event_type.is_explained_absence


@dataclass(eq=False, kw_only=True)
class CorrectionEntry(Entity):
    """Запись об исправлении ранее внесённого факта (Domain Model разд. 6.1).

    «Сама по себе `CorrectionEntry` никогда не удаляет и не перезаписывает
    исходную запись (append-only история)» — поэтому здесь нет ни ссылки
    на «новое значение», ни метода правки: запись фиксирует, что прежний
    факт признан ошибочным, а верный вводится отдельным событием. В БД то
    же самое обеспечивает `trg_correction_entry_append_only` (миграция
    0015).
    """

    timesheet_id: UUID
    original_event_id: UUID
    reason: str
    created_by: UUID
    # Заполняется доменом, а не DEFAULT now() в БД: SQLAlchemy включает
    # атрибут в INSERT, раз он у объекта есть, и серверный DEFAULT до
    # значения не доходит — колонка получила бы NULL. Тот же приём, что у
    # `DomainEvent.occurred_at`.
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def __post_init__(self) -> None:
        # openapi CreateCorrectionEntryRequest: reason minLength 10, и
        # `ck_correction_entry_reason_length` в миграции 0015. «Ошибка»
        # без объяснения объяснением не является.
        if len(self.reason.strip()) < _MINIMUM_REASON_LENGTH:
            raise ValueError(
                f"причина исправления обязана быть содержательной: "
                f"минимум {_MINIMUM_REASON_LENGTH} символов"
            )


@dataclass(eq=False, kw_only=True)
class Timesheet(AggregateRoot):
    employee_id: UUID
    period: AccountingPeriod
    status: TimesheetStatus = TimesheetStatus.OPEN
    events: list[ServiceTimeEvent] = field(default_factory=list)
    corrections: list[CorrectionEntry] = field(default_factory=list)

    @classmethod
    def open_for(cls, *, employee_id: UUID, period: AccountingPeriod) -> Timesheet:
        """TA007. Табель всегда рождается открытым: утверждение — отдельное
        действие командира подразделения (openapi: `approve` под ролью
        `unit_commander`), а не свойство создания."""
        return cls(
            id=uuid4(),
            employee_id=employee_id,
            period=period,
            status=TimesheetStatus.OPEN,
            events=[],
            corrections=[],
        )

    def __setattr__(self, name: str, value: Any) -> None:
        # Личность табеля и его период — ключ агрегата, а не атрибуты:
        # смена периода задним числом означала бы, что утверждённый табель
        # молча стал табелем другого месяца. Зеркало
        # `trg_timesheet_immutability` (миграция 0014).
        #
        # Короткое замыкание через `getattr(..., None)` — по той же
        # причине, что в `scheduling.DutySchedule`: инструментация
        # SQLAlchemy пишет служебные маркеры через этот же `__setattr__`
        # до того, как у объекта появится состояние.
        if name in {"employee_id", "period"}:
            current = getattr(self, name, None)
            if current is not None and current != value:
                raise TimesheetApprovedError(
                    f"{name} табеля неизменяем после создания (Domain Model инвариант 6.1.4)"
                )
        super().__setattr__(name, value)

    # -------------------------------------------------------------- факты

    def register_event(
        self,
        *,
        event_type: ServiceTimeEventType,
        time_range: TimeInterval,
        planned_shift_id: UUID | None = None,
        overtime_order_id: UUID | None = None,
        business_trip_place: str | None = None,
    ) -> ServiceTimeEvent:
        """TA008-TA012. Единая точка входа для всех пяти типов факта.

        Отдельные команды приложения (`RegisterActualShift`,
        `RegisterSickness`, ...) существуют потому, что у них разные роли
        в openapi и разные обязательные поля, — но агрегат отличает их
        только типом: инварианты 6.1.1 и 6.1.4 одинаковы для всех пяти, а
        специфика каждого типа проверена в `ServiceTimeEvent.__post_init__`.
        Пять почти одинаковых методов агрегата разошлись бы при первой же
        правке общего инварианта.
        """
        self._require_editable("зарегистрировать факт в")

        if not self.period.contains(time_range.start.date()):
            raise EventOutsideTimesheetPeriodError(
                f"событие начинается {time_range.start.date()}, а период табеля — "
                f"[{self.period.start}, {self.period.end}); суточное дежурство на стыке "
                f"месяцев регистрируется в табеле периода НАЧАЛА (Алгоритм И)"
            )

        candidate = ServiceTimeEvent(
            id=uuid4(),
            timesheet_id=self.id,
            employee_id=self.employee_id,
            event_type=event_type,
            time_range=time_range,
            planned_shift_id=planned_shift_id,
            overtime_order_id=overtime_order_id,
            business_trip_place=business_trip_place,
        )

        for existing in self.events:
            if existing.overlaps(candidate):
                raise OverlappingServiceTimeEventError(
                    f"факт [{time_range.start}, {time_range.end}) пересекается с уже "
                    f"зарегистрированным {existing.event_type} "
                    f"[{existing.time_range.start}, {existing.time_range.end}); "
                    f"прерванная смена оформляется разбиением на два события, "
                    f"а не наложением (Domain Model инвариант 6.1.1)"
                )

        self.events.append(candidate)
        self._raise_event_for(candidate)
        return candidate

    def _raise_event_for(self, record: ServiceTimeEvent) -> None:
        """TA004: «каждое доменное действие добавляет соответствующее
        событие в буфер» — для тех трёх типов, у которых Domain Model
        разд. 11 такое событие называет (см. докстринг `events.py`)."""
        if record.event_type is ServiceTimeEventType.ACTUAL_SHIFT:
            self.raise_event(
                ShiftActuallyPerformed(
                    timesheet_id=self.id,
                    employee_id=self.employee_id,
                    event_id_of_record=record.id,
                    start_time=record.time_range.start,
                    end_time=record.time_range.end,
                    planned_shift_id=record.planned_shift_id,
                )
            )
        elif record.event_type is ServiceTimeEventType.SICKNESS:
            self.raise_event(
                SicknessRegistered(
                    timesheet_id=self.id,
                    employee_id=self.employee_id,
                    event_id_of_record=record.id,
                    start_time=record.time_range.start,
                    end_time=record.time_range.end,
                )
            )
        elif record.event_type is ServiceTimeEventType.OVERTIME_ATTRACTION:
            # `overtime_order_id` уже не может быть None: инвариант 6.1.2
            # проверен в `ServiceTimeEvent.__post_init__`.
            assert record.overtime_order_id is not None
            self.raise_event(
                OvertimeAttracted(
                    timesheet_id=self.id,
                    employee_id=self.employee_id,
                    event_id_of_record=record.id,
                    start_time=record.time_range.start,
                    end_time=record.time_range.end,
                    overtime_order_id=record.overtime_order_id,
                )
            )

    def correct(
        self, *, original_event_id: UUID, reason: str, created_by: UUID
    ) -> CorrectionEntry:
        """TA014. Исправление не меняет исходную запись — оно её помечает.

        Табель при этом обязан быть редактируемым: внести исправление в
        утверждённый табель, не переоткрыв его, значило бы обойти
        инвариант 6.1.4 через другую дверь.
        """
        self._require_editable("внести исправление в")

        if not any(event.id == original_event_id for event in self.events):
            raise CorrectionTargetNotFoundError(
                f"событие {original_event_id} не принадлежит табелю {self.id}"
            )

        entry = CorrectionEntry(
            id=uuid4(),
            timesheet_id=self.id,
            original_event_id=original_event_id,
            reason=reason,
            created_by=created_by,
        )
        self.corrections.append(entry)
        return entry

    # ------------------------------------------------- утверждение цикла

    def approve(self) -> None:
        """TA015. После этого табель неизменяем (инвариант 6.1.4).

        Утверждать можно как открытый, так и переоткрытый табель: смысл
        переоткрытия в том и состоит, чтобы после исправления утвердить
        заново. Повторное утверждение уже утверждённого — отказ, а не
        идемпотентный успех: оно означало бы новый `HoursBreakdown` по
        тем же фактам, то есть тихую подмену зафиксированного результата.
        """
        if self.status not in {TimesheetStatus.OPEN, TimesheetStatus.REOPENED}:
            raise TimesheetApprovedError(
                f"табель {self.id} в статусе {self.status} — утвердить можно только "
                f"открытый или переоткрытый (Domain Model инвариант 6.1.4)"
            )

        self.status = TimesheetStatus.APPROVED
        self.raise_event(
            TimesheetApproved(
                timesheet_id=self.id,
                employee_id=self.employee_id,
                period_start=self.period.start,
                period_end=self.period.end,
            )
        )

    def reopen(self, *, reason: str) -> None:
        """TA016. Единственный законный путь изменить утверждённый табель.

        Причина обязательна и содержательна: инвариант 6.1.4 требует
        «обязательного указания ответственного и причины», а переоткрытие
        отменяет уже зафиксированный расчёт, на который мог опираться
        расчёт компенсации.
        """
        if self.status != TimesheetStatus.APPROVED:
            raise TimesheetReopenError(
                f"переоткрыть можно только утверждённый табель; {self.id} в статусе "
                f"{self.status}"
            )
        if len(reason.strip()) < _MINIMUM_REASON_LENGTH:
            raise TimesheetReopenError(
                f"причина переоткрытия обязана быть содержательной: минимум "
                f"{_MINIMUM_REASON_LENGTH} символов (Domain Model инвариант 6.1.4)"
            )

        self.status = TimesheetStatus.REOPENED
        self.raise_event(
            TimesheetReopened(
                timesheet_id=self.id, employee_id=self.employee_id, reason=reason
            )
        )

    # ------------------------------------------------------------ чтение

    @property
    def is_editable(self) -> bool:
        return self.status in {TimesheetStatus.OPEN, TimesheetStatus.REOPENED}

    def service_time_events(self) -> list[ServiceTimeEvent]:
        """Алгоритм В шаги 2-4: засчитываемые как факт службы, по
        возрастанию начала."""
        return sorted(
            (e for e in self.events if e.counts_as_service_time),
            key=lambda e: e.time_range.start,
        )

    def explained_absence_events(self) -> list[ServiceTimeEvent]:
        """Алгоритм В шаг 6: болезнь и отстранение."""
        return sorted(
            (e for e in self.events if e.is_explained_absence),
            key=lambda e: e.time_range.start,
        )

    def actual_shift_events(self) -> list[ServiceTimeEvent]:
        """Только фактические смены — единица, о которой говорит
        инвариант 6.1.6."""
        return sorted(
            (e for e in self.events if e.event_type is ServiceTimeEventType.ACTUAL_SHIFT),
            key=lambda e: e.time_range.start,
        )

    def _require_editable(self, action: str) -> None:
        if not self.is_editable:
            raise TimesheetApprovedError(
                f"табель {self.id} в статусе {self.status} — нельзя {action} него; "
                f"изменение утверждённого табеля возможно только после переоткрытия "
                f"(Domain Model инвариант 6.1.4)"
            )
