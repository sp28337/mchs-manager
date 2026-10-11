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

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Env = Literal["dev", "test", "prod"]

# Уровни ровно те, что понимает `logging`. Перечислением, а не строкой:
# опечатка в переменной окружения должна падать при старте с внятным
# сообщением, а не глотать половину журнала молча.
LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]


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

    log_level: LogLevel = "INFO"

    # Строка подключения к базе. Значение по умолчанию ведёт на сервис из
    # docker-compose.yml: так `docker compose up` работает без .env, а
    # пароль `grafik` в нём — заведомо разработческий (см. комментарий в
    # самом compose-файле).
    database_url: str = "postgresql+psycopg://grafik:grafik@postgres:5432/grafik"

    # --- Секреты ---------------------------------------------------------
    #
    # Значения по умолчанию заведомо разработческие и в бою запрещены
    # (см. проверку ниже). Хранить их здесь нельзя: файл в git.

    #: Перец для хэша проверочного значения пароля. Лежит в окружении, а не
    #: в базе: украденной базы не должно хватать для подбора пароля.
    pepper: SecretStr = SecretStr("перец-только-для-разработки")

    #: Ключ подписи access-токенов (HS256).
    jwt_secret: SecretStr = SecretStr("подпись-только-для-разработки")

    # --- Сроки -----------------------------------------------------------

    #: Жизнь access-токена, секунды. Он живёт в памяти вкладки, и 15 минут —
    #: разумный предел для украденного токена.
    access_ttl: int = 15 * 60

    #: Жизнь refresh-токена, дни. Каждое обновление выдаёт новый.
    refresh_ttl_days: int = 30

    @field_validator("log_level", mode="before")
    @classmethod
    def _upper(cls, value: object) -> object:
        """`debug` в переменной окружения — это тоже DEBUG.

        Регистр здесь не несёт смысла, а спотыкаться об него при отладке в
        три часа ночи — обидно.
        """
        return value.upper() if isinstance(value, str) else value

    @model_validator(mode="after")
    def _секреты_в_бою_обязательны(self) -> Settings:
        """В прод нельзя уехать с разработческим секретом.

        Проверка при старте, а не при первом входе: приложение, поднятое с
        перцем из репозитория, лучше не поднять вовсе — иначе об этом
        узнают по утечке.
        """
        if self.env != "prod":
            return self

        слабые = [
            имя
            for имя, значение in (
                ("GRAFIK_PEPPER", self.pepper),
                ("GRAFIK_JWT_SECRET", self.jwt_secret),
            )
            if "разработки" in значение.get_secret_value()
            or len(значение.get_secret_value()) < 32
        ]

        if слабые:
            raise ValueError(
                "в боевом окружении нужны свои длинные значения: " + ", ".join(слабые)
            )

        return self

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
