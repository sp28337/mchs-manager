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
    )
    assert doc_resp.status_code == 201, doc_resp.text
    document_id = doc_resp.json()["id"]

    node_resp = client.post(
        f"/api/v1/legal-rules/documents/{document_id}/nodes",
        json={"nodeType": "article", "ordinalNumber": "54"},
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
    )
    assert rule_resp.status_code == 201, rule_resp.text
    rule_id = rule_resp.json()["id"]

    # Duplicate code -> 409, not 500
    dup_resp = client.post(
        "/api/v1/legal-rules/rules",
        json={"code": rule_code, "category": "norm_calculation", "displayName": "Duplicate"},
    )
    assert dup_resp.status_code == 409, dup_resp.text
    assert dup_resp.json()["detail"]["status"] == 409

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
    )
    assert version_resp.status_code == 201, version_resp.text
    version_id = version_resp.json()["id"]
    assert version_resp.json()["status"] == "draft"

    # 4. Publish it — note the path has ONLY versionId, no ruleId
    publish_resp = client.post(
        f"/api/v1/legal-rules/rule-versions/{version_id}/publish",
        json={"changeReason": "Initial publication via HTTP integration test"},
    )
    assert publish_resp.status_code == 200, publish_resp.text
    assert publish_resp.json()["status"] == "published"

    # Re-publishing must fail with 423 Locked, not 500
    republish_resp = client.post(
        f"/api/v1/legal-rules/rule-versions/{version_id}/publish",
        json={"changeReason": "Attempting to republish, should fail"},
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
    body = resp.json()["detail"]
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
