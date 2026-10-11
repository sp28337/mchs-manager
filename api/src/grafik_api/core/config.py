"""Настройки приложения.

Один источник: переменные окружения с префиксом `GRAFIK_`. Префикс не
украшение — в контейнере рядом живут переменные postgres, uvicorn и самого
Python, и `ENV` или `DEBUG` без префикса однажды совпадут с чужими.

Значения по умолчанию здесь — только безопасные: такие, при которых
приложение поднимется на машине разработчика и не включит ничего лишнего в
бою. Секретов среди них нет и не будет: пароль базы, ключи и перец
приходят из окружения (шаг 13), иначе они попадут в git.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

Env = Literal["dev", "test", "prod"]


class Settings(BaseSettings):
    """Что приложение знает о себе и об окружении."""

    model_config = SettingsConfigDict(
        env_prefix="GRAFIK_",
        env_file=".env",
        env_file_encoding="utf-8",
        # Лишняя переменная в окружении — не повод не запуститься: рядом с
        # нами в контейнере живёт чужое окружение целиком.
        extra="ignore",
    )

    env: Env = "dev"

    # Уровень журналирования строкой, как его понимает logging. Настоящая
    # настройка журналов — шаг 4; здесь значение лежит заранее, чтобы
    # окружение контейнера не пришлось менять задним числом.
    log_level: str = "INFO"

    # Строка подключения к базе. Значение по умолчанию ведёт на сервис из
    # docker-compose.yml: так `docker compose up` работает без .env, а
    # пароль `grafik` в нём — заведомо разработческий (см. комментарий в
    # самом compose-файле).
    database_url: str = "postgresql+psycopg://grafik:grafik@postgres:5432/grafik"

    @property
    def docs_enabled(self) -> bool:
        """Отдавать ли /docs и /openapi.json.

        В бою — нет. Это не «безопасность через неизвестность»: закрытые
        ручки остаются закрытыми, но публиковать полное описание схем,
        лимитов и кодов ошибок без нужды незачем, а черновик описания и так
        лежит в репозитории.
        """
        return self.env != "prod"


@lru_cache
def get_settings() -> Settings:
    """Настройки процесса.

    Кэш — чтобы окружение читалось один раз, а не на каждый запрос, и чтобы
    объект был один и тот же: по нему сравнивают, а не копируют. В тестах
    кэш сбрасывается через `get_settings.cache_clear()`.
    """
    return Settings()
