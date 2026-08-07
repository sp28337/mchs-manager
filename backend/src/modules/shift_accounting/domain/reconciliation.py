"""Сверка расчёта с табелем, который выдали на работе.

--- Почему сверка отдельно от расчёта ----------------------------------

Расчёт отвечает «как должно быть». Сверка отвечает на другой вопрос —
«где расходится и на сколько», — и у неё своя цена ошибки: человек
понесёт её результат к начальнику. Поэтому расхождение не просто
называется, а КВАЛИФИЦИРУЕТСЯ: указывается, какая именно норма нарушена
и на сколько часов. «У вас неверно» — это спор, «норма периода завышена
на 48 часов, потому что 2 смены отпуска не исключены (письмо Роструда от
01.03.2010 № 550-6-1)» — это довод.

--- Почему сравниваются три числа, а не одно ---------------------------

Работодатель может ошибиться в норме, в факте или в обоих. Сравнение
одной итоговой переработки скрыло бы взаимную компенсацию ошибок: норма
завышена на 24 и факт завышен на 24 дают ту же переработку при двух
неверных числах. Поэтому сверяются норма, факт и переработка раздельно.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from src.modules.shift_accounting.domain.calculation import PeriodCalculation

# Табель ведут в часах с округлением; расхождение меньше получаса
# осмысленно считать округлением, а не спором.
TOLERANCE_HOURS = Decimal("0.5")


@dataclass(frozen=True)
class EmployerFigures:
    """Числа из выданного табеля. Любое может отсутствовать."""

    norm_hours: Decimal | None = None
    actual_hours: Decimal | None = None
    overtime_hours: Decimal | None = None


@dataclass(frozen=True)
class Discrepancy:
    """Одно расхождение с объяснением и правовым основанием."""

    field: str
    label: str
    expected: Decimal
    reported: Decimal
    explanation: str
    basis: str

    @property
    def delta(self) -> Decimal:
        """Насколько в табеле больше нашего расчёта."""
        return self.reported - self.expected

    @property
    def favours_employer(self) -> bool:
        """Играет ли расхождение против человека.

        Завышенная норма и заниженные факт или переработка — все против
        него. Обратное направление тоже показывается: сверка обязана
        быть честной в обе стороны, иначе ей не поверят там, где она
        права.
        """
        if self.field == "norm_hours":
            return self.delta > 0
        return self.delta < 0


def _differs(expected: Decimal, reported: Decimal) -> bool:
    return abs(reported - expected) > TOLERANCE_HOURS


def reconcile(
    calculation: PeriodCalculation, reported: EmployerFigures
) -> list[Discrepancy]:
    """Расхождения между расчётом и выданным табелем.

    Пустой список означает «сходится в пределах получаса», и это
    полноценный ответ: человеку важно узнать и что всё верно.
    """
    found: list[Discrepancy] = []

    if reported.norm_hours is not None and _differs(
        calculation.norm_hours, reported.norm_hours
    ):
        overstated = reported.norm_hours > calculation.norm_hours
        # Самая частая причина завышенной нормы — неисключённое
        # отсутствие, и если оно в периоде было, названо будет именно
        # оно: догадка здесь уместна ровно потому, что проверяема — цифра
        # исключённых часов стоит рядом.
        if overstated and calculation.excluded_hours > 0:
            explanation = (
                f"Норма завышена. За период {calculation.absent_shifts} "
                f"смен(ы) пришлись на отсутствие с сохранением места службы — "
                f"это {calculation.excluded_hours} ч по графику, и они должны "
                f"исключаться из нормы, а не отрабатываться позже."
            )
            basis = "письмо Роструда от 01.03.2010 № 550-6-1; ст. 104 ТК РФ"
        elif overstated:
            explanation = (
                "Норма завышена. Она считается по производственному календарю: "
                f"{calculation.calendar.working_days} рабочих дней × "
                f"{calculation.weekly_norm.hours} ч ÷ 5 − "
                f"{calculation.calendar.pre_holiday_days} ч за предпраздничные дни."
            )
            basis = f"{calculation.weekly_norm.basis}; ст. 95, 104 ТК РФ"
        else:
            explanation = (
                "Норма занижена относительно производственного календаря. "
                "Заниженная норма увеличивает переработку — проверьте, не "
                "ошибка ли это в вашу пользу."
            )
            basis = f"{calculation.weekly_norm.basis}; ст. 104 ТК РФ"

        found.append(
            Discrepancy(
                field="norm_hours",
                label="Норма периода",
                expected=calculation.norm_hours,
                reported=reported.norm_hours,
                explanation=explanation,
                basis=basis,
            )
        )

    if reported.actual_hours is not None and _differs(
        calculation.actual_hours, reported.actual_hours
    ):
        understated = reported.actual_hours < calculation.actual_hours
        if understated and calculation.absent_shifts > 0:
            explanation = (
                "Факт занижен. Частая ошибка — вычесть по 24 часа за каждую "
                "смену, попавшую в отпуск или на больничный. Так делать нельзя: "
                "эти часы не отработаны и не должны попадать в факт, но и "
                "вычитаться из него они не могут — они исключаются из НОРМЫ."
            )
        elif understated:
            explanation = (
                f"Факт занижен. По графику караула за период "
                f"{calculation.worked_shifts} отработанных смен, что даёт "
                f"{calculation.actual_hours} ч."
            )
        else:
            explanation = (
                "Факт завышен относительно графика караула. Возможны смены, "
                "не учтённые в вашем профиле, — подмены или привлечения."
            )
        found.append(
            Discrepancy(
                field="actual_hours",
                label="Фактически отработано",
                expected=calculation.actual_hours,
                reported=reported.actual_hours,
                explanation=explanation,
                basis="ст. 91 ТК РФ (обязанность вести точный учёт)",
            )
        )

    if reported.overtime_hours is not None and _differs(
        calculation.overtime_hours, reported.overtime_hours
    ):
        found.append(
            Discrepancy(
                field="overtime_hours",
                label="Переработка",
                expected=calculation.overtime_hours,
                reported=reported.overtime_hours,
                explanation=(
                    "Переработка — это разница между фактом и нормой к отработке: "
                    f"{calculation.actual_hours} − {calculation.norm_hours} = "
                    f"{calculation.overtime_hours} ч. Если норму не уменьшили на "
                    "часы отсутствий, переработка окажется меньше действительной."
                ),
                basis="ст. 99, 104 ТК РФ; ст. 55 ФЗ-141",
            )
        )

    return found
