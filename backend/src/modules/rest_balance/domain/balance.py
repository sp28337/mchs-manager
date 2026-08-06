"""`RestDaysBalance` — агрегат-корень баланса дополнительных суток
отдыха (Domain Model разд. 8.1).

Граница агрегата: один `employee_id`, ведётся на протяжении всей службы.
Не привязан к учётному периоду, в отличие от `Timesheet` и
`CompensationCase`: сутки, начисленные в марте, используются в июне, и
период здесь не граница согласованности, а атрибут движения.

--- Почему агрегат загружается целиком ---------------------------------

Инвариант 8.1.1 проверяется по СУММЕ всех движений сотрудника, поэтому
частично загруженный агрегат не может его проверить: остаток, посчитанный
по половине журнала, — не остаток. Репозиторий загружает все движения
одного сотрудника.

Это осознанная цена. Журнал растёт линейно по времени службы (порядок
величины — десятки движений в год), и «загрузить всё» здесь дешевле, чем
хранить денормализованный остаток, который придётся сверять с историей.
Когда цена перестанет быть приемлемой, ответом будет снимок остатка на
дату (`balance_snapshot`), а не отказ от инварианта в агрегате.

--- Почему инвариант ещё и в БД ----------------------------------------

Триггер `trg_balance_stays_non_negative` (миграция 0021) проверяет то же
самое. Это не дублирование ради надёжности, а разные роли: агрегат
отказывает ДО записи и объясняет причину сотруднику (DoD RB005 — «422 с
указанием текущего остатка»), триггер защищает от конкурентного списания,
которого агрегат в своей транзакции не видит.

Два рапорта, поданные одновременно, оба пройдут проверку в агрегате —
каждый читал журнал до записи другого. Отказать обязана БД, и она берёт
для этого `pg_advisory_xact_lock` по сотруднику.

--- Сторно ------------------------------------------------------------

Инвариант 8.1.3: движение неизменяемо, ошибочное сторнируется
СИММЕТРИЧНОЙ обратной записью. Сторно начисления — списание той же
величины, сторно списания — начисление.

Сторно списания при этом возвращает сутки, а сторно начисления их
отнимает — и второе может увести остаток в минус, если сутки уже
использованы. Такой отказ правилен: сторнировать начисление, по которому
человек уже отгулял, значит требовать вернуть прошедшие выходные.
Разбирается это отдельным решением, а не автоматической записью.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from src.building_blocks.domain.aggregate_root import AggregateRoot
from src.building_blocks.domain.entity import Entity
from src.modules.rest_balance.domain.errors import (
    AccrualWithoutGroundError,
    AlreadyReversedError,
    InsufficientBalanceError,
    MovementImmutableError,
    ReversalReasonRequiredError,
)
from src.modules.rest_balance.domain.events import (
    RestDaysAccrued,
    RestDaysConsumed,
    RestDaysMovementReversed,
)
from src.modules.rest_balance.domain.value_objects import (
    BalancePeriod,
    MovementGround,
    MovementType,
    RestDays,
)

MIN_REVERSAL_REASON_LENGTH = 8


@dataclass(eq=False, kw_only=True)
class BalanceMovement(Entity):
    """Движение баланса — append-only сущность внутри агрегата.

    Поля неизменяемы после создания, и это проверяется здесь, а не только
    триггером: агрегат, позволяющий записать в себя ложь, переложит
    обнаружение ошибки на `flush`, где от неё уже не останется контекста.
    """

    employee_id: UUID
    movement_type: MovementType
    amount: RestDays
    movement_date: date
    ground: MovementGround = field(default_factory=MovementGround)
    reverses_movement_id: UUID | None = None
    reversal_reason: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    _IMMUTABLE = (
        "employee_id",
        "movement_type",
        "amount",
        "movement_date",
        "reverses_movement_id",
        "reversal_reason",
    )

    def __setattr__(self, name: str, value: Any) -> None:
        if name in self._IMMUTABLE:
            current = getattr(self, name, None)
            if current is not None and current != value:
                raise MovementImmutableError(
                    f"{name} движения {getattr(self, 'id', '?')} неизменяемо "
                    f"(Domain Model инвариант 8.1.3): ошибочное движение "
                    f"сторнируется обратной записью, а не правкой"
                )
        super().__setattr__(name, value)

    @property
    def signed_days(self) -> Decimal:
        """Вклад движения в остаток. Знак — от типа, не от величины."""
        if self.movement_type is MovementType.ACCRUAL:
            return self.amount.days
        return -self.amount.days

    @property
    def is_reversal(self) -> bool:
        return self.reverses_movement_id is not None


@dataclass(eq=False, kw_only=True)
class RestDaysBalance(AggregateRoot):
    employee_id: UUID
    movements: list[BalanceMovement] = field(default_factory=list)

    @classmethod
    def for_employee(
        cls, employee_id: UUID, movements: list[BalanceMovement] | None = None
    ) -> RestDaysBalance:
        """Агрегат существует у любого сотрудника, в том числе без единого
        движения: «остаток 0» и «баланс не заведён» — не разные состояния,
        и заводить баланс отдельным действием было бы лишним обрядом.

        `id` совпадает с `employee_id`: агрегат и есть баланс этого
        сотрудника, второго у него быть не может.
        """
        return cls(id=employee_id, employee_id=employee_id, movements=movements or [])

    # ------------------------------------------------------------ остаток

    @property
    def balance_days(self) -> Decimal:
        return sum((m.signed_days for m in self.movements), Decimal(0))

    def balance_as_of(self, day: date) -> Decimal:
        """Остаток на дату — для проверки рапорта, поданного задним
        числом. Движения будущих дат в него не входят."""
        return sum(
            (m.signed_days for m in self.movements if m.movement_date <= day), Decimal(0)
        )

    def movements_in(self, period: BalancePeriod) -> list[BalanceMovement]:
        return [m for m in self.movements if period.contains(m.movement_date)]

    def accrual_for(self, compensation_line_id: UUID) -> BalanceMovement | None:
        """Начисление по строке компенсации, если оно уже было.

        Нужно потребителю события: `CompensationLineCreated` доставляется
        at-least-once, и повторная доставка обязана быть безвредной
        (Architecture разд. 9.2).
        """
        for m in self.movements:
            if (
                m.movement_type is MovementType.ACCRUAL
                and not m.is_reversal
                and m.ground.compensation_line_id == compensation_line_id
            ):
                return m
        return None

    # --------------------------------------------------------- начисление

    def accrue(
        self,
        *,
        amount: RestDays,
        movement_date: date,
        compensation_line_id: UUID,
        legal_basis_rule_version_id: UUID | None = None,
    ) -> BalanceMovement:
        """Алгоритм Л, начисление. Инвариант 8.1.2 — основание обязательно.

        Идемпотентно по `compensation_line_id`: повторный вызов по уже
        начисленной строке возвращает существующее движение, а не создаёт
        второе. Зеркало `uq_balance_accrual_per_compensation_line`.
        """
        if compensation_line_id is None:  # pragma: no cover - защита от None в рантайме
            raise AccrualWithoutGroundError(
                "начисление ДДО без ссылки на строку компенсации невозможно "
                "(Domain Model инвариант 8.1.2)"
            )

        existing = self.accrual_for(compensation_line_id)
        if existing is not None:
            return existing

        movement = self._append(
            movement_type=MovementType.ACCRUAL,
            amount=amount,
            movement_date=movement_date,
            ground=MovementGround.from_compensation_line(compensation_line_id),
        )
        self.raise_event(
            RestDaysAccrued(
                employee_id=self.employee_id,
                movement_id=movement.id,
                amount_days=amount.days,
                movement_date=movement_date,
                compensation_line_id=compensation_line_id,
                legal_basis_rule_version_id=legal_basis_rule_version_id,
                balance_after=self.balance_days,
            )
        )
        return movement

    # ----------------------------------------------------------- списание

    def consume(
        self,
        *,
        amount: RestDays,
        movement_date: date,
        leave_grant_id: UUID | None = None,
    ) -> BalanceMovement:
        """Алгоритм Л, списание. Инвариант 8.1.1 проверяется ДО создания
        движения."""
        self._require_sufficient(amount.days)

        movement = self._append(
            movement_type=MovementType.CONSUMPTION,
            amount=amount,
            movement_date=movement_date,
            ground=(
                MovementGround.from_leave_grant(leave_grant_id)
                if leave_grant_id is not None
                else MovementGround()
            ),
        )
        self.raise_event(
            RestDaysConsumed(
                employee_id=self.employee_id,
                movement_id=movement.id,
                amount_days=amount.days,
                movement_date=movement_date,
                leave_grant_id=leave_grant_id,
                balance_after=self.balance_days,
            )
        )
        return movement

    # ------------------------------------------------------------- сторно

    def reverse(
        self, *, movement_id: UUID, reason: str, movement_date: date | None = None
    ) -> BalanceMovement:
        """Инвариант 8.1.3: симметричная обратная запись с указанием
        причины. Исходное движение не изменяется.

        Дата сторно — по умолчанию сегодня, а не дата исправляемого
        движения: сторно есть событие сегодняшнего дня, и датировать его
        задним числом значило бы менять уже закрытые остатки прошлых дат.
        """
        original = self._movement(movement_id)

        if original.is_reversal:
            raise AlreadyReversedError(
                f"движение {movement_id} само является сторно: сторнировать "
                f"сторно — значит восстанавливать отменённое, и оформляется это "
                f"новым движением по существу, а не отменой отмены"
            )
        if self._reversal_of(movement_id) is not None:
            raise AlreadyReversedError(
                f"движение {movement_id} уже сторнировано: второе сторно вернуло "
                f"бы сотруднику сутки, которых у него не было"
            )
        if len(reason.strip()) < MIN_REVERSAL_REASON_LENGTH:
            raise ReversalReasonRequiredError(
                f"причина сторно короче {MIN_REVERSAL_REASON_LENGTH} символов: "
                f"движение, отменённое без объяснения, для служебной проверки "
                f"неотличимо от ошибки оператора (инвариант 8.1.3)"
            )

        mirrored = (
            MovementType.CONSUMPTION
            if original.movement_type is MovementType.ACCRUAL
            else MovementType.ACCRUAL
        )
        if mirrored is MovementType.CONSUMPTION:
            # Сторно начисления отнимает сутки — и может не найти их на
            # месте, если сотрудник уже отгулял.
            self._require_sufficient(original.amount.days)

        movement = self._append(
            movement_type=mirrored,
            amount=original.amount,
            movement_date=movement_date or date.today(),
            # Основание сторно — исправляемое движение, а не то, по
            # которому возникло исходное: строка компенсации начислением
            # уже «занята» (`uq_balance_accrual_per_compensation_line`), и
            # повторить её здесь значило бы утверждать, что начислений
            # было два.
            ground=MovementGround(),
            reverses_movement_id=original.id,
            reversal_reason=reason.strip(),
        )
        self.raise_event(
            RestDaysMovementReversed(
                employee_id=self.employee_id,
                movement_id=movement.id,
                reversed_movement_id=original.id,
                amount_days=original.amount.days,
                reason=reason.strip(),
                balance_after=self.balance_days,
            )
        )
        return movement

    def _reversal_of(self, movement_id: UUID) -> BalanceMovement | None:
        for m in self.movements:
            if m.reverses_movement_id == movement_id:
                return m
        return None

    # ------------------------------------------------------------ прочее

    def _movement(self, movement_id: UUID) -> BalanceMovement:
        for m in self.movements:
            if m.id == movement_id:
                return m
        raise LookupError(f"движение {movement_id} не принадлежит балансу {self.employee_id}")

    def _require_sufficient(self, requested: Decimal) -> None:
        balance = self.balance_days
        if balance - requested < 0:
            raise InsufficientBalanceError(
                employee_id=self.employee_id, balance=balance, requested=requested
            )

    def _append(
        self,
        *,
        movement_type: MovementType,
        amount: RestDays,
        movement_date: date,
        ground: MovementGround,
        reverses_movement_id: UUID | None = None,
        reversal_reason: str | None = None,
    ) -> BalanceMovement:
        movement = BalanceMovement(
            id=uuid4(),
            employee_id=self.employee_id,
            movement_type=movement_type,
            amount=amount,
            movement_date=movement_date,
            ground=ground,
            reverses_movement_id=reverses_movement_id,
            reversal_reason=reversal_reason,
        )
        self.movements.append(movement)
        return movement
