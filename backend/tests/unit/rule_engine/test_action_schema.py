"""Unit tests for the Action schema (RE005)."""

from __future__ import annotations

import pytest
from pydantic import TypeAdapter, ValidationError

from src.rule_engine.schemas.action import Action, SetResultAction

adapter: TypeAdapter[object] = TypeAdapter(Action)


def test_set_result_action_valid() -> None:
    action = adapter.validate_python(
        {
            "node_type": "set_result",
            "field": "norm_hours",
            "formula": {"node_type": "literal", "value": 40},
        }
    )
    assert isinstance(action, SetResultAction)
    assert action.field == "norm_hours"


def test_action_list_matches_openapi_min_items_one() -> None:
    """openapi.yaml CreateRuleVersionRequest.actions: minItems: 1 — mirrored
    here as a list[Action] with min_length=1 at the call site (Application
    layer), this test only proves a single well-formed Action parses."""
    list_adapter: TypeAdapter[object] = TypeAdapter(list[Action])
    actions = list_adapter.validate_python(
        [
            {
                "node_type": "set_result",
                "field": "coefficient",
                "formula": {"node_type": "literal", "value": 1.5},
            }
        ]
    )
    assert len(actions) == 1


def test_action_is_frozen() -> None:
    action = SetResultAction(field="x", formula={"node_type": "literal", "value": 1})  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        action.field = "y"  # type: ignore[misc]


def test_action_rejects_unknown_discriminator() -> None:
    with pytest.raises(ValidationError):
        adapter.validate_python({"node_type": "raise_flag", "reason": "not implemented yet"})
