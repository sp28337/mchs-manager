"""`NormativeDocument` aggregate — Domain_Model_DDD_Sluzhebnoe_Vremya_FPS.md
разд. 2.1. Root of citation for every RuleVersion's `LegalBasis`;
read-only from the calculation engine's point of view — `Rule`/`RuleVersion`
only ever reference it by `node_id`, never own it (Domain Model разд. 1.1:
"ни один агрегат не хранит ссылку на объект другого агрегата целиком").

`Chapter`/`Article`/`Paragraph` (Domain Model разд. 2.1) are unified here
into a single `DocumentNode` entity discriminated by `node_type`, mirroring
the DB's own single self-referencing table (PostgreSQL_Logical_Model разд.
1.3) — introducing three separate domain classes for what is one physical
table with a type column would only create a translation layer with
nothing behind it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from uuid import UUID, uuid4

from src.building_blocks.domain.aggregate_root import AggregateRoot
from src.building_blocks.domain.entity import Entity
from src.modules.legal_rules.domain.errors import DocumentNodeDuplicatePositionError
from src.modules.legal_rules.domain.value_objects import (
    DocumentNodeType,
    DocumentType,
    EffectivePeriod,
)


@dataclass(eq=False, kw_only=True)
class DocumentNode(Entity):
    document_id: UUID
    parent_node_id: UUID | None
    node_type: DocumentNodeType
    ordinal_number: str
    title: str | None = None
    text_content: str | None = None


@dataclass(eq=False, kw_only=True)
class NormativeDocument(AggregateRoot):
    doc_type: DocumentType
    reg_number: str
    adopted_date: date
    title: str
    validity: EffectivePeriod
    nodes: list[DocumentNode] = field(default_factory=list)

    def add_node(
        self,
        *,
        parent_node_id: UUID | None,
        node_type: DocumentNodeType,
        ordinal_number: str,
        title: str | None = None,
        text_content: str | None = None,
    ) -> DocumentNode:
        """Domain Model разд. 2.1 инвариант 2: numbering of
        Chapter/Article/Paragraph must be unique within the document under
        the same parent.

        `DocumentIdentity` global uniqueness (инвариант 1, doc_type +
        reg_number + adopted_date across ALL documents) is deliberately
        NOT checked here — it spans multiple `NormativeDocument` instances,
        which a single aggregate cannot see; that check belongs to the
        repository/DB unique constraint (`uq_document_identity`,
        PostgreSQL_Logical_Model разд. 1.2), not this method.
        """
        for existing in self.nodes:
            if (
                existing.parent_node_id == parent_node_id
                and existing.node_type == node_type
                and existing.ordinal_number == ordinal_number
            ):
                raise DocumentNodeDuplicatePositionError(
                    f"document {self.id} already has a {node_type} numbered "
                    f"'{ordinal_number}' under parent {parent_node_id}"
                )
        node = DocumentNode(
            id=uuid4(),
            document_id=self.id,
            parent_node_id=parent_node_id,
            node_type=node_type,
            ordinal_number=ordinal_number,
            title=title,
            text_content=text_content,
        )
        self.nodes.append(node)
        return node

    def get_node(self, node_id: UUID) -> DocumentNode:
        for node in self.nodes:
            if node.id == node_id:
                return node
        raise KeyError(f"NormativeDocument {self.id} has no node {node_id}")
