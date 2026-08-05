"""Handler for `ListServiceRecordEntriesQuery`.

Reads the history off the loaded `Employee` aggregate rather than querying
`service_record_entry` directly: the entries are inside the aggregate
boundary (Domain Model разд. 1.1), and `orm_mapping.py` already orders
them by `effective_date`, so there is no second query to write.
"""

from __future__ import annotations

from src.modules.personnel.application.ports import EmployeeRepositoryPort
from src.modules.personnel.application.queries.list_service_record_entries.query import (
    ListServiceRecordEntriesQuery,
)
from src.modules.personnel.domain.errors import EmployeeNotFoundError
from src.modules.personnel.domain.service_record import ServiceRecordEntry


class ListServiceRecordEntriesHandler:
    def __init__(self, repo: EmployeeRepositoryPort) -> None:
        self._repo = repo

    async def handle(self, query: ListServiceRecordEntriesQuery) -> list[ServiceRecordEntry]:
        employee = await self._repo.get(query.employee_id)
        if employee is None:
            raise EmployeeNotFoundError(str(query.employee_id))
        return list(employee.service_record)
