"""Что отдаётся на пути `/legal`."""

from __future__ import annotations

from typing import Self

from pydantic import BaseModel

from grafik_api.core.legal import LEGAL_DOCUMENTS, LegalDocument


class LegalDocumentOut(BaseModel):
    """Редакция документа: версия, дата, адрес и хэш текста."""

    version: str
    #: `null`, пока документ не опубликован.
    effective_from: str | None
    status: str
    url: str
    #: Хэш текста — им подтверждается, с чем именно согласился человек.
    sha256: str

    @classmethod
    def of(cls, документ: LegalDocument) -> Self:
        return cls(
            version=документ.version,
            effective_from=документ.effective_from,
            status=документ.status,
            url=документ.url,
            sha256=документ.sha256,
        )


class LegalDocumentsOut(BaseModel):
    """Все три документа сразу: их читают вместе, при регистрации."""

    policy: LegalDocumentOut
    consent: LegalDocumentOut
    terms: LegalDocumentOut

    @classmethod
    def current(cls) -> Self:
        return cls(
            policy=LegalDocumentOut.of(LEGAL_DOCUMENTS["policy"]),
            consent=LegalDocumentOut.of(LEGAL_DOCUMENTS["consent"]),
            terms=LegalDocumentOut.of(LEGAL_DOCUMENTS["terms"]),
        )
