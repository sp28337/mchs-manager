"""LR012/LR013 — HTTP-level integration test: drives the actual FastAPI
app (not handlers directly) through the full create→publish→resolve
sequence, against a REAL PostgreSQL. This is the first test that proves
the wiring in `composition/api_app.py` + `composition/di.py` actually
works end-to-end, not just that individual handlers do.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import create_async_engine
from starlette.testclient import TestClient

from src.composition.settings import get_settings

pytestmark = pytest.mark.asyncio


def _idem() -> dict[str, str]:
    """`openapi.yaml` требует `Idempotency-Key` у каждой изменяющей
    состояние операции. Роутер `legal_rules` его не требовал — расхождение
    со спецификацией, исправленное вместе с добавлением операций над
    политикой разрешения конфликта категорий."""
    return {"Idempotency-Key": str(uuid4())}


BASE = "/api/v1/legal-rules"


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
async def client():  # type: ignore[misc]
    if not await _db_reachable():
        pytest.skip(
            "PostgreSQL not reachable — start it with `make up` first (see docker-compose.yml)"
        )

    from src.composition.api_app import app

    with TestClient(app) as test_client:
        yield test_client


async def test_full_http_flow_create_publish_resolve(client: TestClient) -> None:
    rule_code = f"TEST.HTTP.{uuid4().hex.upper()}"
    reg_number = f"TEST-HTTP-{uuid4()}"

    # 1. Register the legal basis document
    doc_resp = client.post(
        "/api/v1/legal-rules/documents",
        json={
            "docType": "federal_law",
            "regNumber": reg_number,
            "adoptedDate": "2016-05-23",
            "title": "FZ-141 HTTP test copy",
            "validFrom": "2016-05-23",
        },
        headers=_idem(),
    )
    assert doc_resp.status_code == 201, doc_resp.text
    document_id = doc_resp.json()["id"]

    node_resp = client.post(
        f"/api/v1/legal-rules/documents/{document_id}/nodes",
        json={"nodeType": "article", "ordinalNumber": "54"},
        headers=_idem(),
    )
    assert node_resp.status_code == 201, node_resp.text
    node_id = node_resp.json()["id"]

    # 2. Create the Rule identity
    rule_resp = client.post(
        "/api/v1/legal-rules/rules",
        json={
            "code": rule_code,
            "category": "norm_calculation",
            "displayName": "Норма для HTTP-теста",
        },
        headers=_idem(),
    )
    assert rule_resp.status_code == 201, rule_resp.text
    rule_id = rule_resp.json()["id"]

    # Duplicate code -> 409, not 500
    dup_resp = client.post(
        "/api/v1/legal-rules/rules",
        json={"code": rule_code, "category": "norm_calculation", "displayName": "Duplicate"},
        headers=_idem(),
    )
    assert dup_resp.status_code == 409, dup_resp.text
    assert dup_resp.json()["status"] == 409

    # 3. Draft a RuleVersion
    version_resp = client.post(
        f"/api/v1/legal-rules/rules/{rule_id}/versions",
        json={
            "scope": {"category": "normal"},
            "legalBasisNodeId": node_id,
            "actions": [
                {
                    "node_type": "set_result",
                    "field": "weekly_norm_hours",
                    "formula": {"node_type": "literal", "value": 40},
                }
            ],
            "validFrom": "2024-01-01",
        },
        headers=_idem(),
    )
    assert version_resp.status_code == 201, version_resp.text
    version_id = version_resp.json()["id"]
    assert version_resp.json()["status"] == "draft"

    # 4. Publish it — note the path has ONLY versionId, no ruleId
    publish_resp = client.post(
        f"/api/v1/legal-rules/rule-versions/{version_id}/publish",
        json={"changeReason": "Initial publication via HTTP integration test"},
        headers=_idem(),
    )
    assert publish_resp.status_code == 200, publish_resp.text
    assert publish_resp.json()["status"] == "published"

    # Re-publishing must fail with 423 Locked, not 500
    republish_resp = client.post(
        f"/api/v1/legal-rules/rule-versions/{version_id}/publish",
        json={"changeReason": "Attempting to republish, should fail"},
        headers=_idem(),
    )
    assert republish_resp.status_code == 423, republish_resp.text

    # 5. Resolve it back
    import json as json_module

    resolve_resp = client.get(
        f"/api/v1/legal-rules/rules/{rule_id}/effective-version",
        params={"asOf": "2024-06-01", "scope": json_module.dumps({"category": "normal"})},
    )
    assert resolve_resp.status_code == 200, resolve_resp.text
    body = resolve_resp.json()
    assert body["actions"][0]["field"] == "weekly_norm_hours"
    assert body["actions"][0]["formula"]["value"] == 40

    # A date before valid_from -> 404, not 500
    not_found_resp = client.get(
        f"/api/v1/legal-rules/rules/{rule_id}/effective-version",
        params={"asOf": "2020-01-01", "scope": json_module.dumps({"category": "normal"})},
    )
    assert not_found_resp.status_code == 404, not_found_resp.text

    # cleanup
    engine = create_async_engine(get_settings().database_dsn)
    async with engine.begin() as conn:
        await conn.execute(
            text("DELETE FROM legal_rules.rule_version WHERE rule_id = :id"), {"id": rule_id}
        )
        await conn.execute(text("DELETE FROM legal_rules.rule WHERE id = :id"), {"id": rule_id})
        await conn.execute(
            text("DELETE FROM legal_rules.document_node WHERE document_id = :id"),
            {"id": document_id},
        )
        await conn.execute(
            text("DELETE FROM legal_rules.normative_document WHERE id = :id"), {"id": document_id}
        )
    await engine.dispose()


async def test_get_nonexistent_document_returns_404_problem_json(client: TestClient) -> None:
    resp = client.get(f"/api/v1/legal-rules/documents/{uuid4()}")
    assert resp.status_code == 404
    body = resp.json()
    assert body["status"] == 404
    assert body["type"].startswith("https://api.fps-timekeeping.gov.ru/errors/")
    assert "traceId" in body


async def test_list_rules_paginates_and_filters_by_category(client: TestClient) -> None:
    codes = []
    for i in range(3):
        code = f"TEST.LISTAPI.{i}.{uuid4().hex.upper()[:8]}"
        codes.append(code)
        resp = client.post(
            "/api/v1/legal-rules/rules",
            json={"code": code, "category": "norm_calculation", "displayName": f"r{i}"},
            headers=_idem(),
    )
        assert resp.status_code == 201, resp.text

    resp = client.get(
        "/api/v1/legal-rules/rules",
        params={"category": "norm_calculation", "pageSize": 2, "page": 1},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["page"] == 1
    assert body["pageSize"] == 2
    assert len(body["items"]) == 2
    assert body["totalCount"] >= 3
    assert all(item["category"] == "norm_calculation" for item in body["items"])

    engine = create_async_engine(get_settings().database_dsn)
    async with engine.begin() as conn:
        for code in codes:
            await conn.execute(
                text("DELETE FROM legal_rules.rule WHERE code = :code"), {"code": code}
            )
    await engine.dispose()


# ------------------- политика разрешения конфликта категорий часов


async def test_conflict_policy_can_be_created_versioned_and_published(
    client: TestClient,
) -> None:
    """Операций над политикой в `openapi.yaml` не было вовсе, хотя
    Алгоритм Ж требует её как обязательный вход: без порядка приоритетов
    час, одновременно ночной и праздничный, отнести не к чему, и
    утверждение любого табеля отказывало бы навсегда.

    Порядок `[holiday, weekend, night]` — из примера Алгоритма Ж шаг 3,
    где он помечен как подлежащий юридической проверке (открытый вопрос
    SRS 9.3). Здесь он данные, а не константа кода, — ровно затем, чтобы
    юрист мог его изменить, не трогая расчёт.
    """
    code = f"TEST.PRECEDENCE.{uuid4().hex[:8].upper()}"

    created = client.post(f"{BASE}/conflict-policies", json={"code": code}, headers=_idem())
    assert created.status_code == 201, created.text
    assert created.json()["versions"] == []

    version = client.post(
        f"{BASE}/conflict-policies/{code}/versions",
        json={
            "precedenceList": ["holiday", "weekend", "night"],
            "validFrom": "2019-01-01",
        },
        headers=_idem(),
    )
    assert version.status_code == 201, version.text
    body = version.json()
    # Порядок — это и есть содержание списка, поэтому проверяется он, а не
    # состав.
    assert body["precedenceList"] == ["holiday", "weekend", "night"]
    assert body["status"] == "draft"

    published = client.post(
        f"{BASE}/conflict-policy-versions/{body['id']}/publish", headers=_idem()
    )
    assert published.status_code == 200, published.text
    assert published.json()["status"] == "published"

    republished = client.post(
        f"{BASE}/conflict-policy-versions/{body['id']}/publish", headers=_idem()
    )
    assert republished.status_code == 423, republished.text


async def test_a_duplicate_category_in_the_precedence_list_is_refused(
    client: TestClient,
) -> None:
    """Domain Model разд. 2.3 инвариант 1: категория не может встречаться
    в списке дважды — иначе «приоритет» перестал бы быть порядком."""
    code = f"TEST.PRECEDENCE.{uuid4().hex[:8].upper()}"
    assert (
        client.post(f"{BASE}/conflict-policies", json={"code": code}, headers=_idem()).status_code
        == 201
    )

    response = client.post(
        f"{BASE}/conflict-policies/{code}/versions",
        json={
            "precedenceList": ["holiday", "holiday", "night"],
            "validFrom": "2019-01-01",
        },
        headers=_idem(),
    )
    assert response.status_code == 422, response.text


async def test_an_unknown_hour_category_is_refused_by_the_schema(
    client: TestClient,
) -> None:
    """`overtime` в перечислении есть (документ его называет), а
    `pre_holiday` — нет: предпраздничный день влияет на норму, но
    компенсируемой категорией часа не является."""
    code = f"TEST.PRECEDENCE.{uuid4().hex[:8].upper()}"
    client.post(f"{BASE}/conflict-policies", json={"code": code}, headers=_idem())

    response = client.post(
        f"{BASE}/conflict-policies/{code}/versions",
        json={"precedenceList": ["pre_holiday"], "validFrom": "2019-01-01"},
        headers=_idem(),
    )
    assert response.status_code == 400, response.text


async def test_a_second_policy_with_the_same_code_is_409(client: TestClient) -> None:
    code = f"TEST.PRECEDENCE.{uuid4().hex[:8].upper()}"
    assert (
        client.post(f"{BASE}/conflict-policies", json={"code": code}, headers=_idem()).status_code
        == 201
    )
    duplicate = client.post(
        f"{BASE}/conflict-policies", json={"code": code}, headers=_idem()
    )
    assert duplicate.status_code == 409, duplicate.text
