"""Marker base for Commands — see Architecture, разд. 6 (Vertical Slice
anatomy): `<UseCaseName>Command` is an immutable value object of the
request, validated for FORM only (not business invariants) by the paired
`<UseCaseName>Validator`.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, kw_only=True)
class Command:
    """Every module's `application/commands/<use_case>/command.py` defines
    a concrete Command subclass (usually as a Pydantic frozen model instead,
    per Backend_Architecture разд. 6.1 — Pydantic IS allowed at the
    Application boundary, unlike inside Domain). This dataclass base is the
    fallback for modules that don't need Pydantic's request-body validation
    because the Command is constructed only from already-validated API
    schemas.
    """
