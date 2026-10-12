"""Действующие редакции документов.

Одна ручка, и она открыта без опознания намеренно: политику оператор
обязан публиковать для неограниченного доступа (ч. 2 ст. 18.1 152-ФЗ), а
браузеру версии нужны до регистрации — их он отправляет в записи о
согласии.

Текстов здесь нет: их отдаёт сайт по адресам из ответа (`/privacy`,
`/consent`, `/terms`), собирая страницы из тех же файлов, по которым
считан хэш. Держать текст и в сервере значило бы завести вторую копию,
которая однажды разойдётся с первой.
"""

from __future__ import annotations

from fastapi import APIRouter

from grafik_api.schemas.legal import LegalDocumentsOut

router = APIRouter(prefix="/legal", tags=["legal"])


@router.get("/documents", summary="Действующие версии документов")
async def documents() -> LegalDocumentsOut:
    """Версии, даты вступления в силу и хэши текстов."""
    return LegalDocumentsOut.current()
