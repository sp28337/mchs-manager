"""Value Objects модуля LeaveManagement (Domain Model разд. 9.1)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import StrEnum
from uuid import UUID

from src.building_blocks.domain.value_object import ValueObject


class LeaveType(StrEnum):
    """Mirrors `leave_management.leave_type` (миграция 0022).

    Правовые основания у видов разные, и это существенно при проверке
    права:

    * `BASIC` — основной отпуск, ФЗ-141 ст. 58;
    * `ADDITIONAL` — дополнительные отпуска, ст. 59 (в т.ч. за
      ненормированный служебный день — раздел V Приказа № 410);
    * `PERSONAL_CIRCUMSTANCES_20Y` — отпуск по личным обстоятельствам при
      стаже 20 лет и более, ст. 64 ч. 1 п. 2: ОДИН РАЗ за весь период
      службы;
    * `MATERNITY`, `CHILD_CARE` — по беременности и родам, по уходу за
      ребёнком, ст. 56 ч. 1 и ТК РФ;
    * `EDUCATIONAL` — учебный, ст. 60.
    """

    BASIC = "basic"
    ADDITIONAL = "additional"
    PERSONAL_CIRCUMSTANCES_20Y = "personal_circumstances_20y"
    MATERNITY = "maternity"
    CHILD_CARE = "child_care"
    EDUCATIONAL = "educational"

    @property
    def is_once_per_service(self) -> bool:
        """Виды, право на которые расходуется навсегда (инвариант 9.1.2)."""
        return self is LeaveType.PERSONAL_CIRCUMSTANCES_20Y


class LeaveStatus(StrEnum):
    """Mirrors `leave_management.leave_status`.

    `RECALLED` и `CANCELLED` — не оттенки одного: отозванный отпуск
    СОСТОЯЛСЯ (сотрудник в нём был, часть дней использована), отменённый
    не начинался вовсе. Отсюда разное поведение: отозванный продолжает
    занимать календарь и расходовать одноразовое право, отменённый — нет.
    """

    ACTIVE = "active"
    RECALLED = "recalled"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

    @property
    def occupies_calendar(self) -> bool:
        """Зеркало `WHERE status IN ('active','recalled')` у EXCLUDE."""
        return self in {LeaveStatus.ACTIVE, LeaveStatus.RECALLED}

    @property
    def consumes_once_per_service_right(self) -> bool:
        """Зеркало `WHERE ... status <> 'cancelled'` у частичного
        уникального индекса."""
        return self is not LeaveStatus.CANCELLED


@dataclass(frozen=True, kw_only=True)
class LeavePeriod(ValueObject):
    """{начало, конец} — полуинтервал `[start, end)`.

    Полуоткрытость здесь не соглашение об оформлении, а способ выразить
    инвариант 9.1.1. Документ оговаривает исключение: «присоединение двух
    смежных отпусков в единый непрерывный период НЕ является
    пересечением, а стыковкой границ». Основной отпуск по 14 марта
    включительно и дополнительный с 15 марта — это `[01.03, 15.03)` и
    `[15.03, 20.03)`, и они не пересекаются по определению.

    Отдельного «режима присоединения» поэтому нет: он не нужен там, где
    правильно выбрана граница.
    """

    start: date
    end: date

    def __post_init__(self) -> None:
        if self.end <= self.start:
            raise ValueError(
                f"отпуск [{self.start}, {self.end}) пуст: конец должен быть строго "
                f"позже начала (граница верхняя ИСКЛЮЧАЮЩАЯ — отпуск по 14-е "
                f"включительно записывается как end = 15-е)"
            )

    @property
    def days(self) -> int:
        """Календарных дней. Верхняя граница исключающая, поэтому это
        просто разность."""
        return (self.end - self.start).days

    def overlaps(self, other: LeavePeriod) -> bool:
        return self.start < other.end and other.start < self.end

    def adjoins(self, other: LeavePeriod) -> bool:
        """Смежность — то самое «присоединение» инварианта 9.1.1."""
        return self.end == other.start or other.end == self.start

    def contains(self, day: date) -> bool:
        return self.start <= day < self.end

    def __composite_values__(self) -> tuple[date, date]:
        return self.start, self.end


@dataclass(frozen=True, kw_only=True)
class EntitlementBasis(ValueObject):
    """Ссылка на `RuleVersion` категории `leave_entitlement`,
    обосновывающая продолжительность (Domain Model разд. 9.1).

    Обязательна: отпуск без основания — это дни, взятые неизвестно на
    каком праве, и объяснить их при служебной проверке будет нечем.
    Продолжительность зависит от стажа (ФЗ-141 ст. 58 ч. 3), поэтому
    `seniority_years` хранится рядом — иначе пересчёт задним числом дал
    бы другое число дней и никто бы не понял, почему.
    """

    rule_version_id: UUID
    entitled_days: int
    seniority_years: int | None = None

    def __post_init__(self) -> None:
        if self.entitled_days <= 0:
            raise ValueError(
                f"продолжительность отпуска {self.entitled_days} дн. лишена смысла: "
                f"право на ноль дней не является правом"
            )

    def __composite_values__(self) -> tuple[UUID, int, int | None]:
        """Порядок обязан совпадать с порядком колонок в `composite()`
        (`infrastructure/orm_mapping.py`)."""
        return self.rule_version_id, self.entitled_days, self.seniority_years
