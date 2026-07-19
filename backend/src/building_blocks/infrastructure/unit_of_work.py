"""UnitOfWork port — async context manager, one per Command handler call.

Concrete implementation (SQLAlchemy AsyncSession-backed) lives in each
module's `infrastructure/write/`. The Application layer only ever depends
on this Protocol (Dependency Rule, Architecture разд. 3/7).
"""

from __future__ import annotations

from types import TracebackType
from typing import Protocol, Self


class UnitOfWork(Protocol):
    async def __aenter__(self) -> Self: ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None: ...

    async def commit(self) -> None:
        """Commits the aggregate state change AND the Outbox row written in
        the same local transaction (Architecture, разд. 9.2)."""
        ...

    async def rollback(self) -> None: ...
