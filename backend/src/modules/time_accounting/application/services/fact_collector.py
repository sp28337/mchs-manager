"""TA019 — Алгоритм В: сбор и нормализация фактов периода.

Подготовительный шаг перед классификацией (Алгоритмы Г-Е). Делит события
табеля на две группы (шаг 2) и считает две суммы (шаги 5-6).

--- Что здесь важнее всего не перепутать -------------------------------

`actual_minutes_total` и `explained_absence_minutes` считаются ПО-РАЗНОМУ,
и это не небрежность формулировки, а разный смысл:

* **`actual_minutes_total`** (шаг 5) — вся длительность интервалов первой
  группы. Отработанное время есть отработанное время.

* **`explained_absence_minutes`** (шаг 6) — только та часть болезни или
  отстранения, которая **пересекается с плановыми сменами** сотрудника.
  Причина в том, зачем эта величина нужна: она объясняет НЕДОРАБОТКУ
  (Алгоритм З шаг 5, инвариант 6.1.3). Болезнь в дни, когда человек и так
  не должен был дежурить, ничего не объясняет — недоработки в эти дни не
  возникает. Считать её целиком значило бы «объяснять» недоработку,
  которой нет, и превращать двухнедельный больничный в оправдание
  пропущенных смен следующего месяца.

Именно поэтому сервису нужны плановые смены — факт из чужого модуля
(`scheduling`), приходящий через контракт SD015.

--- Нормализация, которой не нужно происходить -------------------------

Шаги 3-4 говорят «получить непересекающийся набор» и «отсортировать».
Непересечение уже гарантировано инвариантом 6.1.1 и
`excl_service_time_event_no_overlap`, а сортировку отдают методы агрегата
(`service_time_events()`, `explained_absence_events()`). Поэтому здесь нет
кода нормализации: он был бы вторым местом, где чинится то, что не
ломается.
"""

from __future__ import annotations

from dataclasses import dataclass

from src.building_blocks.domain.time_interval import TimeInterval
from src.modules.time_accounting.domain.timesheet import Timesheet


@dataclass(frozen=True, kw_only=True)
class CollectedFacts:
    """Выход Алгоритма В — вход Алгоритмов Г-Е и З."""

    # Интервалы первой группы, по возрастанию начала: их классифицируют
    # Алгоритмы Г, Д, Е.
    service_intervals: list[TimeInterval]
    actual_minutes_total: float
    explained_absence_minutes: float

    @property
    def actual_hours(self) -> float:
        return self.actual_minutes_total / 60


class FactCollectorService:
    """Чистая функция от табеля и плановых смен — ни БД, ни сети."""

    def collect(
        self, *, timesheet: Timesheet, planned_intervals: list[TimeInterval]
    ) -> CollectedFacts:
        service_events = timesheet.service_time_events()
        service_intervals = [event.time_range for event in service_events]

        actual_minutes = sum(
            interval.duration_minutes() for interval in service_intervals
        )

        explained_minutes = 0.0
        for absence in timesheet.explained_absence_events():
            for planned in planned_intervals:
                overlap = absence.time_range.intersection(planned)
                if overlap is not None:
                    explained_minutes += overlap.duration_minutes()

        return CollectedFacts(
            service_intervals=service_intervals,
            actual_minutes_total=actual_minutes,
            explained_absence_minutes=explained_minutes,
        )
