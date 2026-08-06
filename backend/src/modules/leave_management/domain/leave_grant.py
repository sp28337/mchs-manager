"""`LeaveGrant` — агрегат-корень предоставления отпуска (Domain Model
разд. 9.1).

Граница агрегата: ОДНО предоставление одному сотруднику, вместе с
записями об отзывах. Не «все отпуска сотрудника»: инвариант 9.1.1
(непересечение) требует видеть соседние предоставления, но это
межагрегатная проверка, и место ей в доменном сервисе, а не в раздутой
границе. Агрегат, включающий всю историю отпусков за службу, пришлось бы
загружать целиком ради выдачи трёх дней.

--- Где какой инвариант живёт ------------------------------------------

* **9.1.1, непересечение периодов** — НЕ здесь: нужны чужие
  предоставления. Проверяет `LeaveEligibilityService`, последнее слово за
  `excl_leave_period_no_overlap`.
* **9.1.2, одноразовость `personal_circumstances_20y`** — тоже не здесь и
  по той же причине; за БД — `uq_leave_personal_circumstances_once`.
* **9.1.3, отзыв не уменьшает право** — ЗДЕСЬ, целиком. См. ниже.
* **9.1.4, конфликт с утверждённой сменой** — не здесь: смена живёт в
  `scheduling`, и знать о ней агрегат не может. Проверяет
  `ScheduleConflictChecker` через контракт.

--- Инвариант 9.1.3 и почему он про молчание --------------------------

«Наличие `RecallEvent` НЕ уменьшает `EntitlementBasis` — неиспользованный
остаток обязан быть учтён (запрещено „тихое" аннулирование дней отпуска);
модель требует явного создания нового `LeaveGrant` или планового периода
для неиспользованного остатка».

Отсюда устройство отзыва: он НЕ укорачивает `period`. Период остаётся
тем, что был предоставлен приказом, а `RecallEvent` фиксирует, с какой
даты сотрудник в отпуске не находился. Разность и есть неиспользованный
остаток — она вычислима (`unused_days`), а не потеряна.

Соблазн вычесть дни из периода на месте велик и ошибочен: после такой
правки отпуск выглядел бы законно предоставленным на семь дней вместо
двадцати, и доказать, что четырнадцать остались за сотрудником, было бы
нечем. Ровно это документ называет «тихим аннулированием».

ФЗ-141 ст. 65 ч. 3 требует того же по существу: неиспользованная часть
предоставляется в удобное для сотрудника время.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from src.building_blocks.domain.aggregate_root import AggregateRoot
from src.building_blocks.domain.entity import Entity
from src.modules.leave_management.domain.errors import (
    LeaveImmutableError,
    LeaveNotRecallableError,
    RecallOutsideLeaveError,
)
from src.modules.leave_management.domain.events import (
    LeaveGrantCreated,
    LeaveGrantRecalled,
)
from src.modules.leave_management.domain.value_objects import (
    EntitlementBasis,
    LeavePeriod,
    LeaveStatus,
    LeaveType,
)


@dataclass(eq=False, kw_only=True)
class RecallEvent(Entity):
    """{дата отзыва, дата, с которой отпуск прерван} — Domain Model
    разд. 9.1.

    Две даты, а не одна, и разница между ними существенна: приказ издан
    третьего, а сотрудник обязан прибыть пятого. Дни между ними он ещё в
    отпуске, и считать их использованными или нет — вопрос, на который
    одна дата ответить не может.
    """

    leave_grant_id: UUID
    recall_date: date
    effective_from: date
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def __post_init__(self) -> None:
        if self.effective_from < self.recall_date:
            # Зеркало `ck_recall_effective_after_recall`.
            raise ValueError(
                f"отпуск не может быть прерван {self.effective_from} приказом от "
                f"{self.recall_date}: приказ не действует раньше, чем издан"
            )


@dataclass(eq=False, kw_only=True)
class LeaveGrant(AggregateRoot):
    employee_id: UUID
    leave_type: LeaveType
    period: LeavePeriod
    entitlement: EntitlementBasis
    status: LeaveStatus = LeaveStatus.ACTIVE
    # Сутки ДДО, присоединённые к отпуску (Приказ № 410 п. 12). Списание
    # выполняет `rest_balance` — здесь только след того, что оно было.
    attached_rest_days: Decimal = Decimal(0)
    recalls: list[RecallEvent] = field(default_factory=list)

    @classmethod
    def grant(
        cls,
        *,
        employee_id: UUID,
        leave_type: LeaveType,
        period: LeavePeriod,
        entitlement: EntitlementBasis,
        attached_rest_days: Decimal = Decimal(0),
    ) -> LeaveGrant:
        grant = cls(
            id=uuid4(),
            employee_id=employee_id,
            leave_type=leave_type,
            period=period,
            entitlement=entitlement,
            status=LeaveStatus.ACTIVE,
            attached_rest_days=attached_rest_days,
            recalls=[],
        )
        grant.raise_event(
            LeaveGrantCreated(
                grant_id=grant.id,
                employee_id=employee_id,
                leave_type=leave_type,
                period_start=period.start,
                period_end=period.end,
                entitlement_basis_rule_version_id=entitlement.rule_version_id,
                attached_rest_days=attached_rest_days,
            )
        )
        return grant

    def __setattr__(self, name: str, value: Any) -> None:
        # Зеркало `trg_leave_grant_immutability` (миграция 0022).
        # Короткое замыкание через `getattr(..., None)` — по той же
        # причине, что во всех агрегатах кодовой базы: инструментация
        # SQLAlchemy пишет служебные маркеры до появления состояния.
        if name in {"employee_id", "leave_type", "period"}:
            current = getattr(self, name, None)
            if current is not None and current != value:
                raise LeaveImmutableError(
                    f"{name} предоставления отпуска неизменяем: ошибочный приказ "
                    f"отменяется и оформляется заново, а не переписывается"
                )
        super().__setattr__(name, value)

    # -------------------------------------------------------------- отзыв

    def recall(self, *, recall_date: date, effective_from: date) -> RecallEvent:
        """LM007 — отзыв из отпуска (ФЗ-141 ст. 65).

        Период НЕ укорачивается: см. докстринг модуля, инвариант 9.1.3.
        """
        if self.status is not LeaveStatus.ACTIVE:
            raise LeaveNotRecallableError(
                f"отпуск {self.id} в статусе {self.status}: отозвать можно только "
                f"из действующего — прерывать завершённый, отменённый или уже "
                f"прерванный отпуск нечего"
            )

        if not self.period.contains(effective_from):
            raise RecallOutsideLeaveError(
                f"прерывание с {effective_from} лежит вне отпуска "
                f"[{self.period.start}, {self.period.end}): либо сотрудник ещё не "
                f"ушёл, либо уже вышел, и приказ оформлен не тем документом"
            )

        event = RecallEvent(
            id=uuid4(),
            leave_grant_id=self.id,
            recall_date=recall_date,
            effective_from=effective_from,
        )
        self.recalls.append(event)
        self.status = LeaveStatus.RECALLED

        self.raise_event(
            LeaveGrantRecalled(
                grant_id=self.id,
                employee_id=self.employee_id,
                recall_event_id=event.id,
                recall_date=recall_date,
                effective_from=effective_from,
                used_days=self.used_days,
                unused_days=self.unused_days,
            )
        )
        return event

    def cancel(self) -> None:
        """Отмена ошибочного предоставления.

        Освобождает и календарь, и одноразовое право: приказ, признанный
        ошибочным, не расходует того, что сотруднику причитается. Именно
        поэтому оба частичных условия в БД исключают `cancelled`.
        """
        if self.status is LeaveStatus.RECALLED:
            raise LeaveNotRecallableError(
                f"отпуск {self.id} прерван отзывом: он состоялся частично, и "
                f"объявить его небывшим значило бы стереть дни, которые сотрудник "
                f"уже использовал"
            )
        self.status = LeaveStatus.CANCELLED

    # ---------------------------------------------------------- остаток

    @property
    def effective_end(self) -> date:
        """Дата, по которую отпуск фактически длился (исключающая).

        Без отзыва — конец периода. С отзывом — дата прерывания по самому
        раннему из них: вернуть сотрудника в отпуск после отзыва можно
        только новым приказом, то есть новым предоставлением.
        """
        if not self.recalls:
            return self.period.end
        return min(r.effective_from for r in self.recalls)

    @property
    def used_days(self) -> int:
        return (self.effective_end - self.period.start).days

    @property
    def unused_days(self) -> int:
        """Неиспользованный остаток — то, что инвариант 9.1.3 запрещает
        терять молча.

        Считается по ПРЕДОСТАВЛЕННОМУ периоду, а не по праву
        (`entitlement.entitled_days`): право могло быть реализовано
        несколькими приказами, и вычитать из него использованное здесь
        значило бы считать за весь год по одному его отрезку.
        """
        return (self.period.end - self.effective_end).days

    @property
    def is_recalled(self) -> bool:
        return self.status is LeaveStatus.RECALLED
