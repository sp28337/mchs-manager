"""Версия 1 протокола: сборка роутера.

Префикс `/api/v1` навешивается при подключении в `main.py`, поэтому сами
роутеры объявляют только свои пути. Версия в пути — чтобы несовместимое
изменение протокола можно было выпустить, не ломая установленные на
телефонах копии приложения (раздел 10 контракта).
"""

from fastapi import APIRouter

from grafik_api.api.v1 import account, auth, health, sync

router = APIRouter()
router.include_router(health.router)
router.include_router(auth.router)
router.include_router(sync.router)
router.include_router(account.router)

# Дальше здесь появится legal — действующие версии документов с хэшами
# текстов (шаг 12, вместе со страницами).

__all__ = ["router"]
