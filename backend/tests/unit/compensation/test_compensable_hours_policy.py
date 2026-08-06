"""Приказ МЧС России от 24.09.2018 № 410, пп. 11, 13, 14 — что вообще
подлежит компенсации.

Самый «дорогой» блок правил всего модуля: он решает не сколько начислить,
а начислять ли вообще. Ошибка здесь либо лишает караул положенного, либо
начисляет ему компенсацию за саму суть его службы.
"""

from __future__ import annotations

from decimal import Decimal

from src.modules.compensation.application.services.compensable_hours_policy import (
    CompensableHoursPolicy,
)
from src.modules.compensation.domain.value_objects import CompensableHours, HourCategory


def breakdown(
    *, night: str = "0", holiday: str = "0", weekend: str = "0", overtime: str = "0"
) -> CompensableHours:
    return CompensableHours(
        night_hours=Decimal(night),
        holiday_hours=Decimal(holiday),
        weekend_hours=Decimal(weekend),
        overtime_hours=Decimal(overtime),
    )


def test_shift_personnel_lose_night_holiday_and_weekend_within_the_norm() -> None:
    """п. 14. Ночь и праздник у караула — характер службы, а не
    привлечение сверх неё: норма периода уже посчитана с их учётом
    (суммированный учёт, ФЗ-141 ст. 55)."""
    result = CompensableHoursPolicy().compensable(
        breakdown=breakdown(night="48", holiday="24", weekend="24"),
        regime_type="twenty_four_hour_duty",
    )
    assert result.non_empty_categories() == []


def test_shift_personnel_keep_their_overtime() -> None:
    """п. 10: продолжительность сверх нормы за учётный период. Изъятие
    п. 14 касается только часов «в пределах нормальной
    продолжительности»."""
    result = CompensableHoursPolicy().compensable(
        breakdown=breakdown(night="48", overtime="12"),
        regime_type="shift_schedule",
    )
    assert result.non_empty_categories() == [HourCategory.OVERTIME]
    assert result.overtime_hours == Decimal(12)
    assert result.night_hours == Decimal(0)


def test_five_day_week_personnel_keep_everything() -> None:
    """п. 11 без изъятий: у пятидневного режима ночная служба и работа в
    выходной — именно привлечение."""
    result = CompensableHoursPolicy().compensable(
        breakdown=breakdown(night="8", holiday="8", weekend="8", overtime="4"),
        regime_type="five_day_week",
    )
    assert result.non_empty_categories() == [
        HourCategory.NIGHT,
        HourCategory.HOLIDAY,
        HourCategory.WEEKEND,
        HourCategory.OVERTIME,
    ]


def test_unstandardized_personnel_get_nothing() -> None:
    """п. 13: «компенсация не предоставляется». Взамен — дополнительный
    отпуск (раздел V приказа), предмет `leave_management`."""
    result = CompensableHoursPolicy().compensable(
        breakdown=breakdown(night="8", holiday="8", weekend="8", overtime="40"),
        regime_type="unstandardized",
    )
    assert result.non_empty_categories() == []


def test_an_unknown_regime_is_treated_as_the_general_case() -> None:
    """Неизвестный режим получает п. 11 целиком, а не ноль.

    Умолчание выбрано в пользу сотрудника осознанно: изъятия пп. 13-14
    названы в приказе поимённо и распространяются на перечисленные там
    категории должностей, а расширять изъятие на всё непонятое значило бы
    лишать компенсации по причине «система не разобралась».
    """
    result = CompensableHoursPolicy().compensable(
        breakdown=breakdown(night="8"), regime_type="какой-то-новый-режим"
    )
    assert result.night_hours == Decimal(8)
