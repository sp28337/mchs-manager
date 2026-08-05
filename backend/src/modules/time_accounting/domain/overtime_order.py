"""`OvertimeOrder` — приказ о привлечении сверх нормы (TA013).

Отдельный агрегат, а не сущность внутри `Timesheet`, по трём независимым
причинам, каждой из которых хватило бы:

* **Один приказ покрывает многих.** Приказ о привлечении к тушению
  крупного пожара касается смены целиком; будь он частью табеля, его
  пришлось бы дублировать в табель каждого сотрудника, и «тот же приказ»
  стал бы N разными записями с одним номером.
* **Свой жизненный цикл.** Приказ издаётся до фактов, которые на него
  сошлются, и переживает утверждение любого из табелей.
* **Своя уникальность.** `uq_overtime_order_number` — глобальная, а не в
  рамках табеля: номер приказа уникален в делопроизводстве подразделения.

Отсюда же следует, почему `Timesheet` проверяет только НАЛИЧИЕ ссылки, но
не существование приказа: это два разных агрегата, и связь между ними —
внешний ключ в БД плюс проверка в обработчике, а не обход объектов в
памяти (Domain Model разд. 0: агрегат не тянет за собой чужие агрегаты).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from uuid import UUID, uuid4

from src.building_blocks.domain.aggregate_root import AggregateRoot


@dataclass(eq=False, kw_only=True)
class OvertimeOrder(AggregateRoot):
    """Документ-основание (Domain Model разд. 6.1, логическая модель 5.3)."""

    order_number: str
    issued_date: date
    issued_by: UUID
    reason: str

    @classmethod
    def issue(
        cls, *, order_number: str, issued_date: date, issued_by: UUID, reason: str
    ) -> OvertimeOrder:
        if not order_number.strip():
            raise ValueError("номер приказа обязателен")
        if not reason.strip():
            # Приказ без основания привлечения не является основанием:
            # ФЗ-141 ст. 55 допускает привлечение сверх нормы в
            # определённых случаях, и приказ обязан назвать случай.
            raise ValueError("основание привлечения обязательно (ФЗ-141 ст. 55)")

        return cls(
            id=uuid4(),
            order_number=order_number.strip(),
            issued_date=issued_date,
            issued_by=issued_by,
            reason=reason.strip(),
        )
