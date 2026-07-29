"""Write-side repository for the `NormativeDocument` aggregate — mirrors
`rule_repository.py` in shape and in its Transactional-Outbox gap (see
that module's docstring; the same caveat applies here).
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.legal_rules.domain.normative_document import NormativeDocument
from src.modules.legal_rules.domain.value_objects import DocumentType
from src.modules.legal_rules.infrastructure.write.orm_mapping import normative_document_table


class NormativeDocumentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, document_id: UUID) -> NormativeDocument | None:
        return await self._session.get(NormativeDocument, document_id)

    async def get_by_identity(
        self, *, doc_type: DocumentType, reg_number: str, adopted_date: date
    ) -> NormativeDocument | None:
        """`DocumentIdentity` (Domain Model разд. 2.1 инвариант 1) — the
        uniqueness this checks is cross-aggregate, hence lives here rather
        than in `NormativeDocument.add_node()` (see that method's docstring)."""
        result = await self._session.execute(
            select(NormativeDocument).where(
                normative_document_table.c.doc_type == doc_type.value,
                normative_document_table.c.reg_number == reg_number,
                normative_document_table.c.adopted_date == adopted_date,
            )
        )
        return result.scalar_one_or_none()

    def add(self, document: NormativeDocument) -> None:
        self._session.add(document)
