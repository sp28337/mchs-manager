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

from fastapi import APIRouter, Depends, Header, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.application.problem import problem_exception
from src.building_blocks.infrastructure.db import get_session
from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.legal_rules.api.dependencies import get_rule_version_cache
from src.modules.legal_rules.api.schemas import (
    ConflictPolicyResponse,
    ConflictPolicyVersionResponse,
    CreateConflictPolicyRequest,
    CreateConflictPolicyVersionRequest,
    CreateDocumentNodeRequest,
    CreateNormativeDocumentRequest,
    CreateRuleRequest,
    CreateRuleVersionRequest,
    DocumentNodeResponse,
    DryRunRequest,
    DryRunResultResponse,
    DryRunSampleDifference,
    EffectiveRuleVersionResponse,
    NormativeDocumentResponse,
    PublishRuleVersionRequest,
    RuleListEnvelopeResponse,
    RuleResponse,
    RuleVersionDetailResponse,
    RuleVersionResponse,
)
from src.modules.legal_rules.application.commands.create_conflict_policy.command import (
    CreateConflictPolicyCommand,
)
from src.modules.legal_rules.application.commands.create_conflict_policy.handler import (
    CreateConflictPolicyHandler,
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
from src.modules.legal_rules.application.commands.draft_conflict_policy_version.command import (
    DraftConflictPolicyVersionCommand,
)
from src.modules.legal_rules.application.commands.draft_conflict_policy_version.handler import (
    DraftConflictPolicyVersionHandler,
)
from src.modules.legal_rules.application.commands.publish_conflict_policy_version.command import (
    PublishConflictPolicyVersionCommand,
)
from src.modules.legal_rules.application.commands.publish_conflict_policy_version.handler import (
    PublishConflictPolicyVersionHandler,
)
from src.modules.legal_rules.application.commands.publish_rule_version.command import (
    PublishRuleVersionCommand,
)
from src.modules.legal_rules.application.commands.publish_rule_version.handler import (
    PublishRuleVersionHandler,
)
from src.modules.legal_rules.application.queries.dry_run_rule_version.handler import (
    DryRunNotApplicable,
    RuleVersionNotFound,
    dry_run_rule_version,
)
from src.modules.legal_rules.application.queries.get_effective_rule_version.handler import (
    GetEffectiveRuleVersionHandler,
)
from src.modules.legal_rules.application.queries.get_effective_rule_version.query import (
    GetEffectiveRuleVersionQuery,
)
from src.modules.legal_rules.application.queries.list_rule_versions.handler import (
    ListRuleVersionsHandler,
)
from src.modules.legal_rules.application.queries.list_rule_versions.query import (
    ListRuleVersionsQuery,
)
from src.modules.legal_rules.application.queries.list_rules.handler import ListRulesHandler
from src.modules.legal_rules.application.queries.list_rules.query import ListRulesQuery
from src.modules.legal_rules.domain.conflict_policy import (
    ConflictResolutionPolicy,
    ConflictResolutionPolicyVersion,
)
from src.modules.legal_rules.domain.errors import (
    ConflictPolicyDuplicateCategoryError,
    DocumentNodeDuplicatePositionError,
    NormativeDocumentAlreadyExistsError,
    NormativeDocumentNotFoundError,
    PolicyCodeAlreadyExistsError,
    PolicyNotFoundError,
    PolicyVersionImmutableError,
    PolicyVersionOverlapError,
    RuleCodeAlreadyExistsError,
    RuleNotFoundError,
    RuleVersionImmutableError,
    RuleVersionOverlapError,
)
from src.modules.legal_rules.domain.rule import RuleVersion
from src.modules.legal_rules.domain.value_objects import RuleCategory
from src.modules.legal_rules.infrastructure.cache.rule_version_cache import RuleVersionCache
from src.modules.legal_rules.infrastructure.write.conflict_policy_repository import (
    ConflictResolutionPolicyRepository,
)
from src.modules.legal_rules.infrastructure.write.normative_document_repository import (
    NormativeDocumentRepository,
)
from src.modules.legal_rules.infrastructure.write.orm_mapping import outbox_message_table
from src.modules.legal_rules.infrastructure.write.rule_repository import RuleRepository
from src.rule_engine.interpreter.version_resolver import NoApplicableRuleVersionError

router = APIRouter()

SessionDep = Annotated[AsyncSession, Depends(get_session)]
CacheDep = Annotated[RuleVersionCache, Depends(get_rule_version_cache)]

# `openapi.yaml` помечает `Idempotency-Key` обязательным у каждой
# изменяющей состояние операции, и остальные четыре модуля его требуют.
# Этот роутер не требовал — расхождение со спецификацией, а не решение:
# создание правила и публикация версии меняют состояние ровно так же, как
# создание подразделения, и повтор запроса при обрыве связи здесь так же
# нежелателен. (Подавление повторов по ключу — отдельная задача; заголовок
# пока объявлен обязательным, но не хранится, как и в остальных модулях.)
IdempotencyKeyDep = Annotated[UUID, Header(alias="Idempotency-Key")]

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
    request: CreateNormativeDocumentRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
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
    document_id: Annotated[UUID, Path()],
    request: CreateDocumentNodeRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
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
async def create_rule(
    request: CreateRuleRequest, session: SessionDep, idempotency_key: IdempotencyKeyDep
) -> RuleResponse:
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


@router.get("/rules/{rule_id}/versions", response_model=list[RuleVersionDetailResponse])
async def list_rule_versions(
    rule_id: Annotated[UUID, Path()], session: SessionDep
) -> list[RuleVersionDetailResponse]:
    """Дополнение к `openapi.yaml` — см. `ListRuleVersionsQuery`.

    Отдаёт ВСЕ редакции, включая заменённые: история нормы и есть предмет
    этого модуля, а список из одной действующей редакции не отвечал бы на
    вопрос «по какой норме считали в марте».
    """
    handler = ListRuleVersionsHandler(RuleRepository(session))
    try:
        versions = await handler.handle(ListRuleVersionsQuery(rule_id=rule_id))
    except RuleNotFoundError as exc:
        raise _problem(404, "not-found", "Правило не найдено", str(exc)) from exc

    return [
        RuleVersionDetailResponse(
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
            formula_definition=version.formula_definition,
        )
        for version in versions
    ]


@router.post("/rules/{rule_id}/versions", response_model=RuleVersionResponse, status_code=201)
async def create_rule_version(
    rule_id: Annotated[UUID, Path()],
    request: CreateRuleVersionRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
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
    version_id: Annotated[UUID, Path()],
    request: PublishRuleVersionRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
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


# ---------------------------------- Политика разрешения конфликта категорий
#
# Операций над ней в `openapi.yaml` нет вовсе — см. докстринг
# `CreateConflictPolicyRequest`. Это пробел спецификации, из-за которого
# Алгоритм Ж не мог получить свой обязательный вход: порядок приоритетов
# категорий часов невозможно было завести никаким способом, кроме прямого
# INSERT в базу.


def _to_policy_version_response(
    version: ConflictResolutionPolicyVersion,
) -> ConflictPolicyVersionResponse:
    return ConflictPolicyVersionResponse(
        id=version.id,
        policy_id=version.policy_id,
        version_no=version.version_no,
        precedence_list=[category.value for category in version.precedence_list],
        valid_from=version.valid_from,
        valid_to=version.valid_to,
        status=version.status,
    )


def _to_policy_response(policy: ConflictResolutionPolicy) -> ConflictPolicyResponse:
    return ConflictPolicyResponse(
        id=policy.id,
        code=policy.code,
        versions=[
            _to_policy_version_response(v)
            for v in sorted(policy.versions, key=lambda v: v.version_no)
        ],
    )


@router.post("/conflict-policies", response_model=ConflictPolicyResponse, status_code=201)
async def create_conflict_policy(
    request: CreateConflictPolicyRequest, session: SessionDep, idempotency_key: IdempotencyKeyDep
) -> ConflictPolicyResponse:
    handler = CreateConflictPolicyHandler(
        session, ConflictResolutionPolicyRepository(session)
    )
    try:
        policy = await handler.handle(CreateConflictPolicyCommand(code=request.code))
    except PolicyCodeAlreadyExistsError as exc:
        raise _problem(409, "conflict", "Код политики уже используется", str(exc)) from exc
    except ValueError as exc:
        raise _problem(422, "validation-failed", "Некорректная политика", str(exc)) from exc

    return _to_policy_response(policy)


@router.get("/conflict-policies", response_model=list[ConflictPolicyResponse])
async def list_conflict_policies(session: SessionDep) -> list[ConflictPolicyResponse]:
    policies = await ConflictResolutionPolicyRepository(session).list_all()
    return [_to_policy_response(p) for p in policies]


@router.post(
    "/conflict-policies/{policy_code}/versions",
    response_model=ConflictPolicyVersionResponse,
    status_code=201,
)
async def draft_conflict_policy_version(
    policy_code: Annotated[str, Path()],
    request: CreateConflictPolicyVersionRequest,
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> ConflictPolicyVersionResponse:
    handler = DraftConflictPolicyVersionHandler(
        session, ConflictResolutionPolicyRepository(session)
    )
    try:
        version = await handler.handle(
            DraftConflictPolicyVersionCommand(
                policy_code=policy_code,
                precedence_list=tuple(request.precedence_list),
                valid_from=request.valid_from,
                valid_to=request.valid_to,
            )
        )
    except PolicyNotFoundError as exc:
        raise _problem(404, "not-found", "Политика не найдена", str(exc)) from exc
    except ConflictPolicyDuplicateCategoryError as exc:
        raise _problem(
            422,
            "domain-invariant-violation",
            "Категория указана дважды",
            str(exc),
        ) from exc
    except ValueError as exc:
        raise _problem(422, "validation-failed", "Некорректная версия", str(exc)) from exc

    return _to_policy_version_response(version)


@router.post(
    "/conflict-policy-versions/{version_id}/publish",
    response_model=ConflictPolicyVersionResponse,
)
async def publish_conflict_policy_version(
    version_id: Annotated[UUID, Path()],
    session: SessionDep,
    idempotency_key: IdempotencyKeyDep,
) -> ConflictPolicyVersionResponse:
    handler = PublishConflictPolicyVersionHandler(
        session,
        ConflictResolutionPolicyRepository(session),
        OutboxWriter(session, outbox_message_table),
    )
    try:
        version = await handler.handle(
            PublishConflictPolicyVersionCommand(version_id=version_id)
        )
    except PolicyNotFoundError as exc:
        raise _problem(404, "not-found", "Версия политики не найдена", str(exc)) from exc
    except PolicyVersionOverlapError as exc:
        raise _problem(
            409, "overlapping-interval", "Версия пересекается с действующей", str(exc)
        ) from exc
    except PolicyVersionImmutableError as exc:
        raise _problem(
            423, "immutable-resource", "Версия уже опубликована", str(exc)
        ) from exc

    return _to_policy_version_response(version)


@router.post("/rule-versions/{version_id}/dry-run", response_model=DryRunResultResponse)
async def dry_run_rule_version_endpoint(
    version_id: Annotated[UUID, Path()],
    request: DryRunRequest,
    session: SessionDep,
) -> DryRunResultResponse:
    """Песочница для черновика версии: показать последствия ДО публикации.

    Без `Idempotency-Key`, в отличие от остальных `POST` этого роутера, и
    так же в спецификации: операция ничего не меняет. `POST` она лишь
    потому, что принимает тело запроса, — повторный вызов даёт тот же
    ответ и не создаёт ничего.
    """
    try:
        result = await dry_run_rule_version(
            await session.connection(),
            rules=RuleRepository(session),
            version_id=version_id,
            historical_period_start=request.historical_period_start,
            historical_period_end=request.historical_period_end,
            sample_size=request.sample_size,
        )
    except RuleVersionNotFound as exc:
        raise _problem(404, "not-found", "Версия правила не найдена", str(exc)) from exc
    except DryRunNotApplicable as exc:
        raise _problem(
            422, "domain-invariant-violation", "Сравнение невыполнимо", str(exc)
        ) from exc

    return DryRunResultResponse(
        old_value=result.old_value,
        new_value=result.new_value,
        compared_entities=result.compared_entities,
        differences_found=result.differences_found,
        sample_differences=[
            DryRunSampleDifference(
                employee_id=d.employee_id, old_value=d.old_value, new_value=d.new_value
            )
            for d in result.sample_differences
        ],
    )
