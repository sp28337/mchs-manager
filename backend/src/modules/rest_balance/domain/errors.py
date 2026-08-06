"""Доменные исключения RestBalance."""

from __future__ import annotations

from decimal import Decimal


class RestBalanceDomainError(Exception):
    """База для всех ошибок доменного слоя этого модуля."""


class InsufficientBalanceError(RestBalanceDomainError):
    """Domain Model инвариант 8.1.1: `сумма(Accrual) − сумма(Consumption)
    ≥ 0` в любой момент.

    Документ добавляет существенное: проверка выполняется «до создания
    движения `Consumption`, а не постфактум». Отрицательный остаток — не
    состояние, которое потом исправят, а событие, которого не должно
    произойти: сутки отдыха, которых у сотрудника нет, он уже использовал
    бы к моменту обнаружения.

    Несёт остаток и запрошенную величину: DoD RB005 требует, чтобы 422
    называл текущий остаток — иначе сотруднику остаётся угадывать, на
    сколько суток подавать рапорт.
    """

    def __init__(self, *, employee_id: object, balance: Decimal, requested: Decimal) -> None:
        self.balance = balance
        self.requested = requested
        super().__init__(
            f"списание {requested} сут. превышает остаток {balance} сут. "
            f"у сотрудника {employee_id} (Domain Model инвариант 8.1.1)"
        )


class AccrualWithoutGroundError(RestBalanceDomainError):
    """Domain Model инвариант 8.1.2: каждый `Accrual` обязан ссылаться на
    существующий `CompensationLine` с формой `AdditionalRestTime`.

    Формулировка документа — «начисление ДДО не может возникнуть „из
    воздуха", вне процесса компенсации». Половина инварианта проверяется
    здесь (ссылка есть), половина — потребителем события (форма именно
    `additional_rest_time`): форма живёт в `compensation`, и знать о ней
    этот модуль может только из события.

    Отображается в 422."""


class MovementImmutableError(RestBalanceDomainError):
    """Domain Model инвариант 8.1.3: движение не редактируется и не
    удаляется.

    Ошибочное движение сторнируется симметричной обратной записью с
    указанием причины. Это не осторожность, а требование трассируемости
    для служебной проверки: журнал, из которого можно удалить строку, не
    доказывает ничего.

    Отображается в 423."""


class AlreadyReversedError(RestBalanceDomainError):
    """Движение уже сторнировано.

    Второе сторно того же движения вернуло бы сотруднику сутки, которых у
    него не было. Зеркало `uq_balance_movement_reversed_once`.

    Отображается в 409."""


class ReversalReasonRequiredError(RestBalanceDomainError):
    """Инвариант 8.1.3 требует сторно «с указанием причины».

    Движение, отменённое без объяснения, для служебной проверки
    неотличимо от ошибки оператора — а отличать их и есть смысл журнала.

    Отображается в 422."""
