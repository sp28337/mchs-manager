"""Проверки схемы: не «работает ли SQLAlchemy», а держатся ли решения.

Базы этим тестам не нужно — они смотрят на метаданные. Смысл в том, чтобы
решения, которые легко случайно отменить правкой модели, падали тестом, а
не выяснялись на боевой базе:

* перечень таблиц совпадает с картой данных;
* имена ограничений заданы соглашением, а не придуманы PostgreSQL;
* в схеме нет столбцов с открытым секретом;
* удаление аккаунта уносит всё, кроме обезличенной строки аудита.
"""

from __future__ import annotations

import pytest
from sqlalchemy import BigInteger, ForeignKeyConstraint, Table, UniqueConstraint

from grafik_api.db import Base
from grafik_api.models import Blob  # noqa: F401  (тянет регистрацию таблиц)

# Ровно те таблицы, что описаны в `docs/legal/data-map.md`. Новая таблица
# без строки в карте — либо забытая карта, либо данные, которых мы не
# обещали обрабатывать.
ОЖИДАЕМЫЕ_ТАБЛИЦЫ = {
    "users",
    "credentials",
    "data_keys",
    "consents",
    "blobs",
    "blob_revisions",
    "refresh_tokens",
    "one_time_tokens",
    "audit_log",
}


def таблицы() -> dict[str, Table]:
    return dict(Base.metadata.tables)


def test_таблицы_совпадают_с_картой_данных() -> None:
    assert set(таблицы()) == ОЖИДАЕМЫЕ_ТАБЛИЦЫ


@pytest.mark.parametrize("имя", sorted(ОЖИДАЕМЫЕ_ТАБЛИЦЫ))
def test_имена_ограничений_заданы_соглашением(имя: str) -> None:
    """Иначе миграция, удаляющая ограничение по имени, падает на чужой базе."""
    table = таблицы()[имя]

    assert table.primary_key.name == f"pk_{имя}"

    for constraint in table.constraints:
        if isinstance(constraint, ForeignKeyConstraint):
            assert isinstance(constraint.name, str)
            assert constraint.name.startswith(f"fk_{имя}_")

    for index in table.indexes:
        assert isinstance(index.name, str)
        assert index.name.startswith(f"ix_{имя}_")


def test_в_схеме_нет_столбцов_с_открытым_секретом() -> None:
    """Пароль, проверочное значение и токены хранятся только в виде хэша."""
    запрещено = {"password", "verifier", "token", "recovery_key", "dek", "kek"}

    for имя, table in таблицы().items():
        for column in table.columns:
            assert column.name not in запрещено, f"{имя}.{column.name}"
            # Столбец с токеном допустим только как хэш.
            if "token" in column.name:
                assert column.name.endswith(("_hash", "_id")), f"{имя}.{column.name}"


def test_адрес_почты_только_в_одном_месте() -> None:
    """Адрес — единственное, чем мы опознаём человека; копий ему не нужно."""
    места = [
        f"{имя}.{column.name}"
        for имя, table in таблицы().items()
        for column in table.columns
        if "email" in column.name and not column.name.endswith("_at")
    ]

    assert места == ["users.email"]


def test_удаление_аккаунта_уносит_все_его_данные() -> None:
    """Каждая ссылка на аккаунт — с каскадом, иначе удаление не исполнится."""
    for имя, table in таблицы().items():
        for fk in table.foreign_key_constraints:
            if "users.id" in {element.target_fullname for element in fk.elements}:
                assert fk.ondelete == "CASCADE", имя


def test_журнал_событий_не_привязан_к_аккаунту() -> None:
    """После удаления должна остаться обезличенная строка «аккаунт удалён».

    Каскад стёр бы и её, а `ON DELETE SET NULL` стёр бы сам идентификатор —
    то есть ровно то, чем потом подтверждают исполнение удаления.
    """
    assert таблицы()["audit_log"].foreign_key_constraints == set()


def test_надгробие_это_состояние_элемента() -> None:
    """Отдельной таблицы надгробий нет — выборка изменений одним запросом."""
    assert "tombstones" not in таблицы()
    assert "deleted_at" in таблицы()["blobs"].columns


def test_ревизия_это_счётчик_аккаунта() -> None:
    """Одна последовательность на аккаунт (раздел 4 контракта)."""
    rev = таблицы()["users"].columns["rev"]

    assert isinstance(rev.type, BigInteger)
    assert rev.nullable is False
    assert rev.server_default is not None


def test_элемент_опознаётся_видом_и_идентификатором() -> None:
    blobs = таблицы()["blobs"]
    уникальные = {
        tuple(column.name for column in constraint.columns)
        for constraint in blobs.constraints
        if isinstance(constraint, UniqueConstraint)
    }

    assert ("user_id", "kind", "item_id") in уникальные
