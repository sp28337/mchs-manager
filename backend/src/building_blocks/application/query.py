"""Marker base for Queries — mirror of Command, read-only intent."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, kw_only=True)
class Query:
    """Base for `application/queries/<use_case>/query.py`. Query handlers
    read from a Read-model/projection (CQRS modules) or straight from the
    single repository (non-CQRS modules) — never mutate state."""
