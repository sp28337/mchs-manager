"""PE001 (org side) — unit tests for `Unit` and the `HierarchyPath` VO.

`HierarchyPath` is the domain-side counterpart of the `ltree` column
(migration 0006); these tests pin the label sanitization that keeps a
free-text `Unit.code` from ever reaching the DB as an invalid ltree
literal.
"""

from __future__ import annotations

import pytest

from src.modules.personnel.domain.unit import Unit
from src.modules.personnel.domain.value_objects import HierarchyPath


def test_root_unit_has_a_single_label_path() -> None:
    """`ck_unit_root_path` (migration 0006) requires `nlevel = 1` for
    exactly the rows with a NULL parent."""
    root = Unit.create_root(code="MCHS", name="МЧС России")
    assert root.is_root
    assert root.hierarchy_path.depth == 1
    assert root.hierarchy_path.as_ltree() == f"u{root.id.hex}"


def test_child_path_is_derived_from_the_parent_never_supplied() -> None:
    root = Unit.create_root(code="MCHS", name="МЧС России")
    region = Unit.create_child(code="RC_CENTRAL", name="Центральный РЦ", parent=root)
    station = Unit.create_child(code="PCH-12", name="ПЧ-12", parent=region)

    assert station.parent_unit_id == region.id
    assert station.hierarchy_path.labels == (
        f"u{root.id.hex}",
        f"u{region.id.hex}",
        f"u{station.id.hex}",
    )
    assert station.hierarchy_path.depth == 3


def test_containment_is_answered_from_the_path_alone() -> None:
    root = Unit.create_root(code="MCHS", name="МЧС России")
    region = Unit.create_child(code="RC_CENTRAL", name="Центральный РЦ", parent=root)
    station = Unit.create_child(code="PCH-12", name="ПЧ-12", parent=region)
    other_region = Unit.create_child(code="RC_URAL", name="Уральский РЦ", parent=root)

    assert root.contains(station)
    assert region.contains(station)
    assert not other_region.contains(station)
    assert not station.contains(station), "containment is strict — a unit is not under itself"


def test_units_with_codes_that_differ_only_in_punctuation_get_distinct_paths() -> None:
    """The reason labels come from ids, not codes: any sanitizing transform
    of free-text codes collapses distinct codes onto one label, and two
    units sharing a path would corrupt every subtree query."""
    root = Unit.create_root(code="MCHS", name="МЧС России")
    a = Unit.create_child(code="ПЧ-12", name="ПЧ-12", parent=root)
    b = Unit.create_child(code="ПЧ 12", name="ПЧ 12", parent=root)

    assert a.hierarchy_path != b.hierarchy_path


def test_label_is_always_a_valid_ltree_label() -> None:
    root = Unit.create_root(code="любой код, хоть с пробелами", name="Тест")
    assert HierarchyPath.label_for(root.id) == f"u{root.id.hex}"
    # Constructing the VO re-validates: this would raise on a bad label.
    assert HierarchyPath(labels=(HierarchyPath.label_for(root.id),)).depth == 1


def test_invalid_label_is_rejected_by_the_value_object() -> None:
    with pytest.raises(ValueError, match="invalid ltree label"):
        HierarchyPath(labels=("not a label",))


def test_from_ltree_round_trips() -> None:
    raw = "u0123456789abcdef0123456789abcdef.uf0e1d2c3b4a5968778695a4b3c2d1e0f"
    path = HierarchyPath.from_ltree(raw)
    assert path.depth == 2
    assert path.as_ltree() == raw
