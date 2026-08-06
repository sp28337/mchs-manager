"""LM008 — список отпусков сотрудника.

Без пагинации, как в `openapi.yaml`: отпусков за службу — десятки, и
конверт со страницами добавил бы клиенту работу ради выборки, которая и
так помещается в один ответ.

Отменённые предоставления включены: список отпусков есть кадровая
история, и скрыть из неё ошибочный приказ значило бы сделать вид, что его
не издавали.
"""

from __future__ import annotations

from uuid import UUID

from src.modules.leave_management.application.ports import LeaveGrantRepositoryPort
from src.modules.leave_management.domain.leave_grant import LeaveGrant


class GetEmployeeLeaveGrantsHandler:
    def __init__(self, repo: LeaveGrantRepositoryPort) -> None:
        self._repo = repo

    async def handle(self, employee_id: UUID) -> list[LeaveGrant]:
        return await self._repo.list_for_employee(employee_id)
