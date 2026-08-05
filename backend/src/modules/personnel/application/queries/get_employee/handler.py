"""Handler for `GetEmployeeQuery` (PE010)."""

from __future__ import annotations

from src.modules.personnel.application.ports import EmployeeRepositoryPort
from src.modules.personnel.application.queries.get_employee.query import GetEmployeeQuery
from src.modules.personnel.domain.employee import Employee
from src.modules.personnel.domain.errors import EmployeeNotFoundError


class GetEmployeeHandler:
    def __init__(self, repo: EmployeeRepositoryPort) -> None:
        self._repo = repo

    async def handle(self, query: GetEmployeeQuery) -> Employee:
        employee = await self._repo.get(query.employee_id)
        if employee is None:
            raise EmployeeNotFoundError(str(query.employee_id))
        return employee
