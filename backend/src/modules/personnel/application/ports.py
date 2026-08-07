"""Ports the `personnel` Application layer depends on.

Concrete implementations live in `infrastructure/repositories.py` and are
injected into handler constructors by the caller — a handler must never
import a concrete infrastructure class (Architecture разд. 3, 7:
"Application импортирует только Domain... Infrastructure реализует
интерфейсы, объявленные в Application/Domain"). `.importlinter`'s
`layers-personnel` contract fails the build on `application ->
infrastructure`, which is what this file exists to satisfy — same
arrangement, and same history, as `legal_rules/application/ports.py`.
"""

from __future__ import annotations

from typing import Protocol
from uuid import UUID

from src.modules.personnel.domain.employee import Employee
from src.modules.personnel.domain.position import Position
from src.modules.personnel.domain.unit import Unit


class UnitRepositoryPort(Protocol):
    async def get(self, unit_id: UUID) -> Unit | None: ...
    async def get_by_code(self, code: str) -> Unit | None: ...
    async def list_subtree(self, unit_id: UUID) -> list[Unit]: ...
    async def list_all(self) -> list[Unit]: ...
    def add(self, unit: Unit) -> None: ...


class PositionRepositoryPort(Protocol):
    async def get(self, position_id: UUID) -> Position | None: ...
    async def get_by_code(self, code: str) -> Position | None: ...
    def add(self, position: Position) -> None: ...


class EmployeeRepositoryPort(Protocol):
    async def get(self, employee_id: UUID) -> Employee | None: ...
    async def get_by_personnel_number(self, personnel_number: str) -> Employee | None: ...
    async def list(
        self, *, unit_id: UUID | None, page: int, page_size: int
    ) -> tuple[list[Employee], int]: ...
    def add(self, employee: Employee) -> None: ...
