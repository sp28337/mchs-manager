"""Handler for `CreateNormativeDocumentCommand` (LR006)."""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.legal_rules.application.commands.create_normative_document.command import (
    CreateNormativeDocumentCommand,
)
from src.modules.legal_rules.application.ports import NormativeDocumentRepositoryPort
from src.modules.legal_rules.domain.errors import NormativeDocumentAlreadyExistsError
from src.modules.legal_rules.domain.normative_document import NormativeDocument
from src.modules.legal_rules.domain.value_objects import EffectivePeriod


class CreateNormativeDocumentHandler:
    def __init__(self, session: AsyncSession, repo: NormativeDocumentRepositoryPort) -> None:
        self._session = session
        self._repo = repo

    async def handle(self, command: CreateNormativeDocumentCommand) -> NormativeDocument:
        # Domain Model разд. 2.1 инвариант 1 (DocumentIdentity uniqueness)
        # — cross-aggregate, so checked here, not inside the aggregate
        # (see NormativeDocument.add_node() docstring for the same point
        # made about node positions).
        existing = await self._repo.get_by_identity(
            doc_type=command.doc_type,
            reg_number=command.reg_number,
            adopted_date=command.adopted_date,
        )
        if existing is not None:
            raise NormativeDocumentAlreadyExistsError(
                f"{command.doc_type} {command.reg_number} adopted "
                f"{command.adopted_date} already exists"
            )

        document = NormativeDocument(
            id=uuid4(),
            doc_type=command.doc_type,
            reg_number=command.reg_number,
            adopted_date=command.adopted_date,
            title=command.title,
            validity=EffectivePeriod(valid_from=command.valid_from, valid_to=command.valid_to),
        )
        self._repo.add(document)
        await self._session.commit()
        return document
