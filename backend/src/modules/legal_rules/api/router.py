"""LR012 — `legal_rules` API router. Presentation-layer rule (Architecture
разд. 3): knows only about Application (Command/Query + Handler), never
imports `domain`/`infrastructure` for business logic — it constructs
concrete repositories only because there is no DI container assembling
handlers yet; that construction is infrastructure wiring, not business
logic. Note what it does NOT import: `composition/di.py`. A module that
imports the Composition Root transitively imports every other module —
see `building_blocks/infrastructure/db.py`.

Domain exceptions -> RFC 7807 `Problem` mapping follows API_Conventions_FPS.md
разд. 3's catalog exactly (`404` not-found, `409` overlapping/conflict,
`422` domain-invariant-violation, `423` immutable-resource).
"""

from __future__ import annotations

import json
from datetime import date as date_cls
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.application.problem import problem_exception
from src.building_blocks.infrastructure.db import get_session
from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.legal_rules.api.dependencies import get_rule_version_cache
from src.modules.legal_rules.api.schemas import (
    CreateDocumentNodeRequest,
    CreateNormativeDocumentRequest,
    CreateRuleRequest,
    CreateRuleVersionRequest,
    DocumentNodeResponse,
    EffectiveRuleVersionResponse,
    NormativeDocumentResponse,
    PublishRuleVersionRequest,
    RuleListEnvelopeResponse,
    RuleResponse,
    RuleVersionResponse,
)
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
from src.modules.legal_rules.application.queries.list_rules.handler import ListRulesHandler
from src.modules.legal_rules.application.queries.list_rules.query import ListRulesQuery
from src.modules.legal_rules.domain.errors import (
    DocumentNodeDuplicatePositionError,
    NormativeDocumentAlreadyExistsError,
    NormativeDocumentNotFoundError,
    RuleCodeAlreadyExistsError,
    RuleNotFoundError,
    RuleVersionImmutableError,
    RuleVersionOverlapError,
)
from src.modules.legal_rules.domain.rule import RuleVersion
from src.modules.legal_rules.domain.value_objects import RuleCategory
from src.modules.legal_rules.infrastructure.cache.rule_version_cache import RuleVersionCache
from src.modules.legal_rules.infrastructure.write.normative_document_repository import (
    NormativeDocumentRepository,
)
from src.modules.legal_rules.infrastructure.write.orm_mapping import outbox_message_table
from src.modules.legal_rules.infrastructure.write.rule_repository import RuleRepository
from src.rule_engine.interpreter.version_resolver import NoApplicableRuleVersionError

router = APIRouter()

SessionDep = Annotated[AsyncSession, Depends(get_session)]
CacheDep = Annotated[RuleVersionCache, Depends(get_rule_version_cache)]

# The RFC 7807 builder is shared across every module's router
# (`building_blocks/application/problem.py`) rather than reimplemented per
# module — see that module's docstring for why it lives there.
_problem = problem_exception


def _to_rule_version_response(version: RuleVersion) -> RuleVersionResponse:
    return RuleVersionResponse(
        id=version.id,
        rule_id=version.rule_id,
        version_no=version.version_no,
        scope=version.scope.as_dict(),
        legal_basis_node_id=version.legal_basis.node_id,
        valid_from=version.valid_from,
        valid_to=version.valid_to,
        status=version.status,
        published_at=version.published_at,
        published_by=version.published_by,
    )


@router.post("/documents", response_model=NormativeDocumentResponse, status_code=201)
async def create_normative_document(
    request: CreateNormativeDocumentRequest, session: SessionDep
) -> NormativeDocumentResponse:
    handler = CreateNormativeDocumentHandler(session, NormativeDocumentRepository(session))
    try:
        document = await handler.handle(
            CreateNormativeDocumentCommand(
                doc_type=request.doc_type,
                reg_number=request.reg_number,
                adopted_date=request.adopted_date,
                title=request.title,
                valid_from=request.valid_from,
                valid_to=request.valid_to,
            )
        )
    except NormativeDocumentAlreadyExistsError as exc:
        raise _problem(
            409, "document-already-exists", "Документ уже зарегистрирован", str(exc)
        ) from exc

    return NormativeDocumentResponse(
        id=document.id,
        doc_type=document.doc_type,
        reg_number=document.reg_number,
        adopted_date=document.adopted_date,
        title=document.title,
        valid_from=document.validity.valid_from,
        valid_to=document.validity.valid_to,
    )


@router.get("/documents/{document_id}", response_model=NormativeDocumentResponse)
async def get_normative_document(
    document_id: Annotated[UUID, Path()], session: SessionDep
) -> NormativeDocumentResponse:
    document = await NormativeDocumentRepository(session).get(document_id)
    if document is None:
        raise _problem(
            404, "not-found", "Документ не найден", f"NormativeDocument {document_id} not found"
        )

    return NormativeDocumentResponse(
        id=document.id,
        doc_type=document.doc_type,
        reg_number=document.reg_number,
        adopted_date=document.adopted_date,
        title=document.title,
        valid_from=document.validity.valid_from,
        valid_to=document.validity.valid_to,
    )


@router.post("/documents/{document_id}/nodes", response_model=DocumentNodeResponse, status_code=201)
async def create_document_node(
    document_id: Annotated[UUID, Path()], request: CreateDocumentNodeRequest, session: SessionDep
) -> DocumentNodeResponse:
    handler = CreateDocumentNodeHandler(session, NormativeDocumentRepository(session))
    try:
        node = await handler.handle(
            CreateDocumentNodeCommand(
                document_id=document_id,
                parent_node_id=request.parent_node_id,
                node_type=request.node_type,
                ordinal_number=request.ordinal_number,
                title=request.title,
                text_content=request.text_content,
            )
        )
    except NormativeDocumentNotFoundError as exc:
        raise _problem(404, "not-found", "Документ не найден", str(exc)) from exc
    except DocumentNodeDuplicatePositionError as exc:
        raise _problem(
            409, "overlapping-position", "Узел с таким номером уже существует", str(exc)
        ) from exc

    return DocumentNodeResponse(
        id=node.id,
        document_id=node.document_id,
        parent_node_id=node.parent_node_id,
        node_type=node.node_type,
        ordinal_number=node.ordinal_number,
        title=node.title,
        text_content=node.text_content,
    )


@router.post("/rules", response_model=RuleResponse, status_code=201)
async def create_rule(request: CreateRuleRequest, session: SessionDep) -> RuleResponse:
    handler = CreateRuleHandler(session, RuleRepository(session))
    try:
        rule = await handler.handle(
            CreateRuleCommand(
                code=request.code,
                category=request.category,
                display_name=request.display_name,
                description=request.description,
            )
        )
    except RuleCodeAlreadyExistsError as exc:
        raise _problem(409, "rule-code-conflict", "Код правила уже используется", str(exc)) from exc

    return RuleResponse(
        id=rule.id,
        code=rule.code,
        category=rule.category,
        display_name=rule.display_name,
        description=rule.description,
    )


@router.get("/rules", response_model=RuleListEnvelopeResponse)
async def list_rules(
    session: SessionDep,
    category: Annotated[RuleCategory | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=200)] = 50,
) -> RuleListEnvelopeResponse:
    handler = ListRulesHandler(RuleRepository(session))
    rules, total_count = await handler.handle(
        ListRulesQuery(category=category, page=page, page_size=page_size)
    )

    return RuleListEnvelopeResponse(
        items=[
            RuleResponse(
                id=r.id,
                code=r.code,
                category=r.category,
                display_name=r.display_name,
                description=r.description,
            )
            for r in rules
        ],
        page=page,
        page_size=page_size,
        total_count=total_count,
    )


@router.post("/rules/{rule_id}/versions", response_model=RuleVersionResponse, status_code=201)
async def create_rule_version(
    rule_id: Annotated[UUID, Path()], request: CreateRuleVersionRequest, session: SessionDep
) -> RuleVersionResponse:
    handler = CreateRuleVersionHandler(session, RuleRepository(session))
    try:
        version = await handler.handle(
            CreateRuleVersionCommand(
                rule_id=rule_id,
                scope=request.scope,
                legal_basis_node_id=request.legal_basis_node_id,
                actions=request.actions,
                valid_from=request.valid_from,
                valid_to=request.valid_to,
            )
        )
    except RuleNotFoundError as exc:
        raise _problem(404, "not-found", "Правило не найдено", str(exc)) from exc

    return _to_rule_version_response(version)


@router.post("/rule-versions/{version_id}/publish", response_model=RuleVersionResponse)
async def publish_rule_version(
    version_id: Annotated[UUID, Path()], request: PublishRuleVersionRequest, session: SessionDep
) -> RuleVersionResponse:
    repo = RuleRepository(session)
    rule = await repo.get_by_version_id(version_id)
    if rule is None:
        raise _problem(
            404, "not-found", "Версия правила не найдена", f"rule_version {version_id} not found"
        )

    handler = PublishRuleVersionHandler(
        session, repo, OutboxWriter(session, outbox_message_table)
    )
    try:
        version = await handler.handle(
            PublishRuleVersionCommand(
                rule_id=rule.id,
                version_id=version_id,
                # TODO(auth): read from JWT `sub` claim once the auth
                # dependency exists (API_Conventions разд. 2) — a random
                # UUID is a placeholder, not a real actor identity.
                published_by=uuid4(),
                change_reason=request.change_reason,
            )
        )
    except RuleVersionOverlapError as exc:
        raise _problem(
            409, "overlapping-interval", "Версия пересекается с действующей", str(exc)
        ) from exc
    except RuleVersionImmutableError as exc:
        raise _problem(423, "immutable-resource", "Версия уже опубликована", str(exc)) from exc

    return _to_rule_version_response(version)


@router.get("/rules/{rule_id}/effective-version", response_model=EffectiveRuleVersionResponse)
async def get_effective_rule_version(
    rule_id: Annotated[UUID, Path()],
    session: SessionDep,
    cache: CacheDep,
    as_of: Annotated[str, Query(alias="asOf")],
    scope: Annotated[str, Query()],
) -> EffectiveRuleVersionResponse:
    """`scope` arrives as a JSON-encoded string query param per
    `openapi.yaml` (`GET .../effective-version`: 'JSON-строка scope,
    например {"legalBase":"fps_service"}') — parsed here at the API
    boundary, not pushed down into the Query/Handler."""
    rule = await RuleRepository(session).get(rule_id)
    if rule is None:
        raise _problem(404, "not-found", "Правило не найдено", f"Rule {rule_id} not found")

    try:
        scope_dict = json.loads(scope)
        as_of_date = date_cls.fromisoformat(as_of)
    except (ValueError, TypeError) as exc:
        raise _problem(
            400, "validation-failed", "Некорректные параметры запроса", str(exc)
        ) from exc

    # version_resolver works over a raw AsyncConnection, not an
    # AsyncSession — `session.connection()` returns the AsyncConnection
    # already bound to this request's transaction (Context7
    # /websites/sqlalchemy_en_20, "Accessing the Underlying Connection
    # from a Session"), rather than opening a second, separate connection.
    connection = await session.connection()
    try:
        resolved = await GetEffectiveRuleVersionHandler(connection, cache).handle(
            GetEffectiveRuleVersionQuery(rule_code=rule.code, scope=scope_dict, as_of=as_of_date)
        )
    except NoApplicableRuleVersionError as exc:
        raise _problem(
            404, "rule-version-not-found", "Не найдена действующая версия правила", str(exc)
        ) from exc

    return EffectiveRuleVersionResponse(
        id=resolved.id,
        rule_id=resolved.rule_id,
        version_no=resolved.version_no,
        valid_from=resolved.valid_from,
        valid_to=resolved.valid_to,
        actions=resolved.actions,
    )
