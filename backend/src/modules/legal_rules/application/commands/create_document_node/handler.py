"""Handler for `CreateDocumentNodeCommand`."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.legal_rules.application.commands.create_document_node.command import (
    CreateDocumentNodeCommand,
)
from src.modules.legal_rules.application.ports import NormativeDocumentRepositoryPort
from src.modules.legal_rules.domain.errors import NormativeDocumentNotFoundError
from src.modules.legal_rules.domain.normative_document import DocumentNode


class CreateDocumentNodeHandler:
    def __init__(self, session: AsyncSession, repo: NormativeDocumentRepositoryPort) -> None:
        self._session = session
        self._repo = repo

    async def handle(self, command: CreateDocumentNodeCommand) -> DocumentNode:
        document = await self._repo.get(command.document_id)
        if document is None:
            raise NormativeDocumentNotFoundError(str(command.document_id))

        # Duplicate-position invariant (Domain Model разд. 2.1 инвариант 2)
        # is enforced inside add_node() itself, not here.
        node = document.add_node(
            parent_node_id=command.parent_node_id,
            node_type=command.node_type,
            ordinal_number=command.ordinal_number,
            title=command.title,
            text_content=command.text_content,
        )
        await self._session.commit()
        return node
