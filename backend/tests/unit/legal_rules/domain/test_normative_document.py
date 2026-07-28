"""Unit tests for the `NormativeDocument` aggregate: node numbering
uniqueness (Domain Model разд. 2.1 инвариант 2). Zero DB, zero HTTP."""

from __future__ import annotations

from datetime import date
from uuid import uuid4

import pytest

from src.modules.legal_rules.domain.errors import DocumentNodeDuplicatePositionError
from src.modules.legal_rules.domain.normative_document import NormativeDocument
from src.modules.legal_rules.domain.value_objects import (
    DocumentNodeType,
    DocumentType,
    EffectivePeriod,
)


def _make_document() -> NormativeDocument:
    return NormativeDocument(
        id=uuid4(),
        doc_type=DocumentType.FEDERAL_LAW,
        reg_number="141-FZ",
        adopted_date=date(2016, 5, 23),
        title="FZ-141",
        validity=EffectivePeriod(valid_from=date(2016, 5, 23)),
    )


def test_add_node_builds_a_hierarchy() -> None:
    doc = _make_document()
    chapter = doc.add_node(
        parent_node_id=None, node_type=DocumentNodeType.CHAPTER, ordinal_number="8"
    )
    article = doc.add_node(
        parent_node_id=chapter.id, node_type=DocumentNodeType.ARTICLE, ordinal_number="54"
    )

    assert article.parent_node_id == chapter.id
    assert article.document_id == doc.id
    assert len(doc.nodes) == 2


def test_duplicate_position_under_same_parent_is_rejected() -> None:
    doc = _make_document()
    chapter = doc.add_node(
        parent_node_id=None, node_type=DocumentNodeType.CHAPTER, ordinal_number="8"
    )
    doc.add_node(parent_node_id=chapter.id, node_type=DocumentNodeType.ARTICLE, ordinal_number="54")

    with pytest.raises(DocumentNodeDuplicatePositionError):
        doc.add_node(
            parent_node_id=chapter.id, node_type=DocumentNodeType.ARTICLE, ordinal_number="54"
        )


def test_same_ordinal_number_under_different_parent_is_allowed() -> None:
    doc = _make_document()
    chapter_a = doc.add_node(
        parent_node_id=None, node_type=DocumentNodeType.CHAPTER, ordinal_number="8"
    )
    chapter_b = doc.add_node(
        parent_node_id=None, node_type=DocumentNodeType.CHAPTER, ordinal_number="9"
    )

    article_a = doc.add_node(
        parent_node_id=chapter_a.id, node_type=DocumentNodeType.ARTICLE, ordinal_number="1"
    )
    article_b = doc.add_node(
        parent_node_id=chapter_b.id, node_type=DocumentNodeType.ARTICLE, ordinal_number="1"
    )

    assert article_a.id != article_b.id


def test_same_ordinal_different_node_type_is_allowed() -> None:
    """A chapter numbered '1' and an article numbered '1' at the top level
    are different positions (node_type is part of the uniqueness key)."""
    doc = _make_document()
    doc.add_node(parent_node_id=None, node_type=DocumentNodeType.CHAPTER, ordinal_number="1")
    article = doc.add_node(
        parent_node_id=None, node_type=DocumentNodeType.ARTICLE, ordinal_number="1"
    )
    assert article is not None


def test_get_node_raises_key_error_for_unknown_id() -> None:
    doc = _make_document()
    with pytest.raises(KeyError):
        doc.get_node(uuid4())
