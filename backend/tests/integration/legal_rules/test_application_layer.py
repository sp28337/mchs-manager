"""LR006-LR010 — end-to-end integration test for the `legal_rules`
Application layer, against a REAL PostgreSQL: create a Rule, cite a real
NormativeDocument/DocumentNode as its legal basis, draft a RuleVersion,
publish it, then resolve it back via `GetEffectiveRuleVersion` — the same
chain a real HTTP request sequence would drive once `api/router.py`
(LR012) exists.
"""

from __future__ import annotations

from datetime import date
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from src.composition.settings import get_settings
from src.modules.legal_rules.application.commands.create_document_node.command import (
    CreateDocumentNodeCommand,
)
from src.modules.legal_rules.application.commands.create_document_node.handler import (
    CreateDocumentNodeHandler,
)
from src.modules.legal_rules.application.commands.create_normative_document.command import (
    CreateNormativeDocumentCommand,
)
from src.modules.legal_rules.application.commands.create_normative_document.handler import (
    CreateNormativeDocumentHandler,
)
from src.modules.legal_rules.application.commands.create_rule.command import CreateRuleCommand
from src.modules.legal_rules.application.commands.create_rule.handler import CreateRuleHandler
from src.modules.legal_rules.application.commands.create_rule_version.command import (
    CreateRuleVersionCommand,
)
from src.modules.legal_rules.application.commands.create_rule_version.handler import (
    CreateRuleVersionHandler,
)
from src.modules.legal_rules.application.commands.publish_rule_version.command import (
    PublishRuleVersionCommand,
)
from src.modules.legal_rules.application.commands.publish_rule_version.handler import (
    PublishRuleVersionHandler,
)
from src.modules.legal_rules.application.queries.get_effective_rule_version.handler import (
    GetEffectiveRuleVersionHandler,
)
from src.modules.legal_rules.application.queries.get_effective_rule_version.query import (
    GetEffectiveRuleVersionQuery,
)
from src.modules.legal_rules.domain.errors import (
    NormativeDocumentAlreadyExistsError,
    RuleCodeAlreadyExistsError,
)
from src.modules.legal_rules.domain.value_objects import (
    DocumentNodeType,
    DocumentType,
    RuleCategory,
)
from src.modules.legal_rules.infrastructure.write.normative_document_repository import (
    NormativeDocumentRepository,
)
from src.modules.legal_rules.infrastructure.write.orm_mapping import start_mappers
from src.modules.legal_rules.infrastructure.write.rule_repository import RuleRepository
from src.rule_engine.interpreter.version_resolver import NoApplicableRuleVersionError

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


async def test_full_create_publish_resolve_flow(engine: AsyncEngine) -> None:
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    rule_code = f"TEST.NORM.{uuid4().hex.upper()}"
    reg_number = f"TEST-{uuid4()}"

    async with session_factory() as session:
        rule_repo = RuleRepository(session)
        document_repo = NormativeDocumentRepository(session)

        # 1. Rule identity
        rule = await CreateRuleHandler(session, rule_repo).handle(
            CreateRuleCommand(
                code=rule_code,
                category=RuleCategory.NORM_CALCULATION,
                display_name="Норма для теста",
            )
        )

        # 2. Legal basis: a real document + node
        document = await CreateNormativeDocumentHandler(session, document_repo).handle(
            CreateNormativeDocumentCommand(
                doc_type=DocumentType.FEDERAL_LAW,
                reg_number=reg_number,
                adopted_date=date(2016, 5, 23),
                title="FZ-141 test copy",
                valid_from=date(2016, 5, 23),
            )
        )
        node = await CreateDocumentNodeHandler(session, document_repo).handle(
            CreateDocumentNodeCommand(
                document_id=document.id, node_type=DocumentNodeType.ARTICLE, ordinal_number="54"
            )
        )

        # 3. Draft a RuleVersion citing that node
        version = await CreateRuleVersionHandler(session, rule_repo).handle(
            CreateRuleVersionCommand(
                rule_id=rule.id,
                scope={"category": "normal"},
                legal_basis_node_id=node.id,
                actions=[
                    {
                        "node_type": "set_result",
                        "field": "weekly_norm_hours",
                        "formula": {"node_type": "literal", "value": 40},
                    }
                ],
                valid_from=date(2024, 1, 1),
            )
        )

        # 4. Publish it
        published = await PublishRuleVersionHandler(session, rule_repo).handle(
            PublishRuleVersionCommand(
                rule_id=rule.id,
                version_id=version.id,
                published_by=uuid4(),
                change_reason="Initial publication for integration test",
            )
        )
        assert published.status.value == "published"

    # 5. Resolve it back — GetEffectiveRuleVersion, over a raw connection
    # (Query-side, no ORM identity map involved — separate from the
    # session used for writes above, matching how a real read path works).
    async with engine.connect() as connection:
        resolved = await GetEffectiveRuleVersionHandler(connection).handle(
            GetEffectiveRuleVersionQuery(
                rule_code=rule_code, scope={"category": "normal"}, as_of=date(2024, 6, 1)
            )
        )
        assert resolved.actions[0].field == "weekly_norm_hours"  # type: ignore[union-attr]
        assert resolved.actions[0].formula.value == 40  # type: ignore[union-attr]

        # A date before valid_from must not resolve.
        with pytest.raises(NoApplicableRuleVersionError):
            await GetEffectiveRuleVersionHandler(connection).handle(
                GetEffectiveRuleVersionQuery(
                    rule_code=rule_code, scope={"category": "normal"}, as_of=date(2020, 1, 1)
                )
            )

    async with engine.begin() as conn:
        await conn.execute(
            text("DELETE FROM legal_rules.rule_version WHERE rule_id = :id"), {"id": rule.id}
        )
        await conn.execute(text("DELETE FROM legal_rules.rule WHERE id = :id"), {"id": rule.id})
        await conn.execute(
            text("DELETE FROM legal_rules.document_node WHERE document_id = :id"),
            {"id": document.id},
        )
        await conn.execute(
            text("DELETE FROM legal_rules.normative_document WHERE id = :id"), {"id": document.id}
        )


async def test_create_rule_rejects_duplicate_code(engine: AsyncEngine) -> None:
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    code = f"TEST.DUP.{uuid4().hex.upper()}"

    async with session_factory() as session:
        await CreateRuleHandler(session, RuleRepository(session)).handle(
            CreateRuleCommand(
                code=code, category=RuleCategory.NORM_CALCULATION, display_name="First"
            )
        )

    async with session_factory() as session:
        with pytest.raises(RuleCodeAlreadyExistsError):
            await CreateRuleHandler(session, RuleRepository(session)).handle(
                CreateRuleCommand(
                    code=code, category=RuleCategory.NORM_CALCULATION, display_name="Duplicate"
                )
            )

    async with engine.begin() as conn:
        await conn.execute(text("DELETE FROM legal_rules.rule WHERE code = :code"), {"code": code})


async def test_create_normative_document_rejects_duplicate_identity(engine: AsyncEngine) -> None:
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    reg_number = f"TEST-DUP-{uuid4()}"
    command = CreateNormativeDocumentCommand(
        doc_type=DocumentType.FEDERAL_LAW,
        reg_number=reg_number,
        adopted_date=date(2016, 5, 23),
        title="First",
        valid_from=date(2016, 5, 23),
    )

    async with session_factory() as session:
        await CreateNormativeDocumentHandler(session, NormativeDocumentRepository(session)).handle(
            command
        )

    async with session_factory() as session:
        with pytest.raises(NormativeDocumentAlreadyExistsError):
            await CreateNormativeDocumentHandler(
                session, NormativeDocumentRepository(session)
            ).handle(command)

    async with engine.begin() as conn:
        await conn.execute(
            text("DELETE FROM legal_rules.normative_document WHERE reg_number = :reg"),
            {"reg": reg_number},
        )
