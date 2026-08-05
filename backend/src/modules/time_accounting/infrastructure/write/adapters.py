"""Реализации портов `time_accounting` поверх контрактов чужих модулей.

Единственное место в модуле, которому позволено знать, что `personnel`
вообще существует. Обработчики видят только `EmployeeExistencePort` —
форму вопроса, — и потому тестируются без `personnel` и без БД
(Architecture разд. 4.2).
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.personnel.contracts.get_employee_snapshot import (
    EmployeeNotFound,
    get_employee_snapshot,
)


class PersonnelEmployeeExistence:
    """`EmployeeExistencePort` поверх контракта `personnel`.

    Спрашивается именно существование, а не статус: табель за прошлый
    период открывается и уволенному — служебное время за отработанный
    период считается независимо от того, служит ли человек сегодня.
    Контракт при этом отдаёт снимок целиком, поэтому «существует» здесь —
    просто отсутствие `EmployeeNotFound`.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def exists(self, employee_id: UUID) -> bool:
        try:
            await get_employee_snapshot(self._session, employee_id=employee_id)
        except EmployeeNotFound:
            return False
        return True
