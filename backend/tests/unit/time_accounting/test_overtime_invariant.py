"""TA003 — инвариант 6.1.2: привлечение сверх нормы требует приказа.

Отдельный файл, а не пара тестов в `test_timesheet_invariants.py`, потому
что это единственный инвариант агрегата, который приходит не из логики
времени, а из права: ФЗ-141 ст. 55 допускает привлечение сверх
установленной продолжительности только в определённых случаях, и приказ —
это документ, называющий случай. SRS разд. 8 п. 1 фиксирует то же как
бизнес-правило, а Domain Model поднимает его до инварианта целостности.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from src.building_blocks.domain.time_interval import TimeInterval
from src.modules.time_accounting.domain.errors import OvertimeWithoutOrderError
from src.modules.time_accounting.domain.events import OvertimeAttracted
from src.modules.time_accounting.domain.overtime_order import OvertimeOrder
from src.modules.time_accounting.domain.timesheet import Timesheet
from src.modules.time_accounting.domain.value_objects import (
    AccountingPeriod,
    AccountingPeriodType,
    ServiceTimeEventType,
)

MOSCOW = ZoneInfo("Europe/Moscow")


def timesheet() -> Timesheet:
    return Timesheet.open_for(
        employee_id=uuid4(),
        period=AccountingPeriod(
            period_type=AccountingPeriodType.MONTH,
            start=date(2026, 3, 1),
            end=date(2026, 4, 1),
        ),
    )


def interval(day: int = 2, hour: int = 8, hours: int = 6) -> TimeInterval:
    start = datetime(2026, 3, day, hour, tzinfo=MOSCOW)
    return TimeInterval(start=start, end=start + timedelta(hours=hours))


def test_overtime_without_an_order_is_refused() -> None:
    sheet = timesheet()
    with pytest.raises(OvertimeWithoutOrderError):
        sheet.register_event(
            event_type=ServiceTimeEventType.OVERTIME_ATTRACTION, time_range=interval()
        )
    assert sheet.events == []


def test_overtime_with_an_order_is_registered_and_raises_its_event() -> None:
    sheet = timesheet()
    order_id = uuid4()

    event = sheet.register_event(
        event_type=ServiceTimeEventType.OVERTIME_ATTRACTION,
        time_range=interval(),
        overtime_order_id=order_id,
    )

    assert event.overtime_order_id == order_id
    assert event.counts_as_service_time

    raised = [e for e in sheet.pull_pending_events() if isinstance(e, OvertimeAttracted)]
    assert len(raised) == 1
    assert raised[0].overtime_order_id == order_id


def test_an_order_on_an_ordinary_shift_is_refused() -> None:
    """Обратная сторона инварианта: приказ о привлечении сверх нормы не
    имеет смысла на обычной смене. Без этой проверки ссылка на приказ
    могла бы оказаться на любом событии, и «часы по приказу» перестали бы
    быть определимым множеством — а именно оно идёт в компенсацию
    (Алгоритм К)."""
    sheet = timesheet()
    with pytest.raises(OvertimeWithoutOrderError):
        sheet.register_event(
            event_type=ServiceTimeEventType.ACTUAL_SHIFT,
            time_range=interval(),
            overtime_order_id=uuid4(),
        )


def test_an_order_needs_a_number_and_a_ground() -> None:
    with pytest.raises(ValueError, match="номер"):
        OvertimeOrder.issue(
            order_number="  ", issued_date=date(2026, 3, 1), issued_by=uuid4(), reason="пожар"
        )
    with pytest.raises(ValueError, match="основание"):
        OvertimeOrder.issue(
            order_number="17-лс", issued_date=date(2026, 3, 1), issued_by=uuid4(), reason=" "
        )


def test_an_issued_order_keeps_its_ground() -> None:
    order = OvertimeOrder.issue(
        order_number=" 17-лс ",
        issued_date=date(2026, 3, 1),
        issued_by=uuid4(),
        reason="тушение крупного пожара, привлечение свободной смены",
    )
    assert order.order_number == "17-лс"
    assert "пожара" in order.reason
