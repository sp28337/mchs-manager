"""Domain-layer tests must run with zero DB/HTTP — this file is the proof
that building_blocks/domain has no infrastructure imports at all."""

from dataclasses import dataclass
from uuid import uuid4

from src.building_blocks.domain import AggregateRoot, DomainEvent, Entity


def test_entity_equality_is_by_id_not_by_attributes() -> None:
    shared_id = uuid4()

    @dataclass(eq=False, kw_only=True)
    class Dummy(Entity):
        label: str

    a = Dummy(id=shared_id, label="first")
    b = Dummy(id=shared_id, label="second")

    assert a == b  # same id -> equal, even though `label` differs


def test_aggregate_root_buffers_and_drains_events() -> None:
    @dataclass(frozen=True, kw_only=True)
    class SomethingHappened(DomainEvent):
        detail: str

    @dataclass(eq=False, kw_only=True)
    class DummyAggregate(AggregateRoot):
        pass

    agg = DummyAggregate(id=uuid4())
    agg.raise_event(SomethingHappened(detail="x"))
    agg.raise_event(SomethingHappened(detail="y"))

    events = agg.pull_pending_events()

    assert [e.detail for e in events] == ["x", "y"]  # type: ignore[attr-defined]
    assert agg.pull_pending_events() == []  # drained, not re-emitted
