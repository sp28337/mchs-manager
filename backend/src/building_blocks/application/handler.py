"""CommandHandler / QueryHandler Protocols.

Handlers are the *only* place that orchestrates: repo.get -> domain method
-> repo.save (Command) or read-model.get (Query). Business invariants live
in the aggregate's own methods, never here (Architecture, разд. 6).
"""

from __future__ import annotations

from typing import Protocol, TypeVar

from src.building_blocks.application.command import Command
from src.building_blocks.application.query import Query

TCommand = TypeVar("TCommand", bound=Command, contravariant=True)
TQuery = TypeVar("TQuery", bound=Query, contravariant=True)
TResult = TypeVar("TResult", covariant=True)


class CommandHandler(Protocol[TCommand, TResult]):
    async def handle(self, command: TCommand) -> TResult: ...


class QueryHandler(Protocol[TQuery, TResult]):
    async def handle(self, query: TQuery) -> TResult: ...
