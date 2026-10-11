"""Версия 1 протокола: сборка роутера.

Префикс `/api/v1` навешивается при подключении в `main.py`, поэтому сами
роутеры объявляют только свои пути. Версия в пути — чтобы несовместимое
изменение протокола можно было выпустить, не ломая установленные на
телефонах копии приложения (раздел 10 контракта).
"""

from fastapi import APIRouter

from grafik_api.api.v1 import health

router = APIRouter()
router.include_router(health.router)

# Дальше здесь появятся auth (шаг 7), sync (шаг 8), account и legal (шаг 9).

__all__ = ["router"]
