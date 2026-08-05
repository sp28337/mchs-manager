"""Handler for `ListEmployeesQuery` (PE010)."""

from __future__ import annotations

from src.modules.personnel.application.ports import EmployeeRepositoryPort
from src.modules.personnel.application.queries.list_employees.query import ListEmployeesQuery
from src.modules.personnel.domain.employee import Employee


class ListEmployeesHandler:
    def __init__(self, repo: EmployeeRepositoryPort) -> None:
        self._repo = repo

    async def handle(self, query: ListEmployeesQuery) -> tuple[list[Employee], int]:
        return await self._repo.list(
            unit_id=query.unit_id, page=query.page, page_size=query.page_size
        )
