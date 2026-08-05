"""Integration test: `NormativeDocument`/`DocumentNode` persist and reload
correctly through the imperative ORM mapping, against a REAL PostgreSQL —
proves `composite()` for `EffectivePeriod` (valid_from/valid_to) and the
self-referencing `nodes` relationship (parent_node_id) round-trip
correctly, not just that they compile.
"""

from __future__ import annotations

from datetime import date
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from src.composition.settings import get_settings
from src.modules.legal_rules.domain.normative_document import NormativeDocument
from src.modules.legal_rules.domain.value_objects import (
    DocumentNodeType,
    DocumentType,
    EffectivePeriod,
)
from src.modules.legal_rules.infrastructure.write.orm_mapping import start_mappers

pytestmark = pytest.mark.asyncio

try:
    start_mappers()
except Exception:  # noqa: BLE001 — already-mapped is fine if pytest re-imports this module
    pass


async def _db_reachable() -> bool:
    try:
        engine = create_async_engine(get_settings().database_dsn)
        async with engine.connect():
            pass
        await engine.dispose()
        return True
    except (OperationalError, OSError):
        # OSError matters: asyncpg raises a bare ConnectionRefusedError when the
        # port is closed, and SQLAlchemy does not wrap OS-level errors in
        # OperationalError — catching only the latter made this check a no-op
        # in exactly the case it exists for. See tests/integration/conftest.py.
        return False


@pytest.fixture
async def engine() -> AsyncEngine:  # type: ignore[misc]
    if not await _db_reachable():
        pytest.skip(
            "PostgreSQL not reachable — start it with `make up` first (see docker-compose.yml)"
        )
    eng = create_async_engine(get_settings().database_dsn)
    yield eng
    await eng.dispose()


async def test_document_with_nested_nodes_round_trips(engine: AsyncEngine) -> None:
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    doc_id = uuid4()

    async with session_factory() as session:
        doc = NormativeDocument(
            id=doc_id,
            doc_type=DocumentType.FEDERAL_LAW,
            reg_number=f"TEST-{uuid4()}",
            adopted_date=date(2016, 5, 23),
            title="FZ-141 test copy",
            validity=EffectivePeriod(valid_from=date(2016, 5, 23)),
        )
        chapter = doc.add_node(
            parent_node_id=None, node_type=DocumentNodeType.CHAPTER, ordinal_number="8"
        )
        doc.add_node(
            parent_node_id=chapter.id,
            node_type=DocumentNodeType.ARTICLE,
            ordinal_number="54",
            title="Служебное время",
            text_content="...",
        )
        session.add(doc)
        await session.commit()

    async with session_factory() as session:
        loaded = await session.get(NormativeDocument, doc_id)
        assert loaded is not None
        assert loaded.validity == EffectivePeriod(
            valid_from=date(2016, 5, 23)
        )  # composite round-trips
        assert len(loaded.nodes) == 2

        article = next(n for n in loaded.nodes if n.node_type == DocumentNodeType.ARTICLE)
        chapter_reloaded = next(n for n in loaded.nodes if n.node_type == DocumentNodeType.CHAPTER)
        assert article.parent_node_id == chapter_reloaded.id
        assert article.title == "Служебное время"

    async with engine.begin() as conn:
        await conn.execute(
            text("DELETE FROM legal_rules.document_node WHERE document_id = :id"), {"id": doc_id}
        )
        await conn.execute(
            text("DELETE FROM legal_rules.normative_document WHERE id = :id"), {"id": doc_id}
        )
