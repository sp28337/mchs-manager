"""Аккаунт: кто он, чем подтверждает пароль, чем открывает свои данные.

Что здесь есть и чего нет, сверено с `docs/legal/data-map.md`: данных, не
перечисленных в карте, в базе быть не должно.

**Солей здесь нет намеренно.** Соли выводятся из нормализованного адреса
почты (`SHA-256("grafik13/auth/v1|" + email)`, раздел 2.1 контракта) — то
есть вычисляются заново и хранить их незачем. План шага 5 обещал столбцы
для солей; контракт их отменил, и это не оплошность, а осознанное
расхождение.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    LargeBinary,
    String,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column, relationship

from grafik_api.db.base import Base, TimestampMixin


class User(TimestampMixin, Base):
    """Человек с аккаунтом — ровно то, что сервер о нём знает."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)

    # Адрес хранится уже нормализованным (NFKC, обрезка, нижний регистр):
    # нормализует сервис, и только так уникальность означает то, что от неё
    # ждут — «один человек, один аккаунт». 254 знака — предел адреса по
    # RFC 5321.
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False)

    email_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Ревизия аккаунта: одна последовательность на аккаунт, а не на элемент
    # (раздел 4 контракта). Растёт при каждой записи и служит курсором
    # выборки изменений. Счётчиком в строке, а не последовательностью
    # PostgreSQL: последовательность одна на базу и не откатывается, а нам
    # нужен независимый порядок внутри каждого аккаунта.
    rev: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default=text("0")
    )

    credential: Mapped[Credential | None] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )
    data_keys: Mapped[list[DataKey]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    consents: Mapped[list[Consent]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Credential(TimestampMixin, Base):
    """Чем проверяется пароль.

    На сервер приходит не пароль, а проверочное значение
    (`verifier = argon2id(пароль, соль_входа)`), и даже оно хранится только
    в виде хэша: `argon2id(HMAC-SHA256(перец, verifier))`. Перец лежит в
    окружении, а не в базе — чтобы украденной базы не хватило для подбора.
    """

    __tablename__ = "credentials"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )

    # Строка в формате argon2 (`$argon2id$v=19$m=…`): в ней и параметры, и
    # соль, поэтому отдельных столбцов под них не нужно.
    verifier_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    # Версия параметров вывода ключа на стороне браузера (`kdf_v1`).
    # Хранится у аккаунта, чтобы поднять стойкость можно было позже и не
    # всем сразу: старые аккаунты продолжают входить по своим параметрам
    # (раздел 2.1 контракта).
    kdf_version: Mapped[str] = mapped_column(String(32), nullable=False)

    user: Mapped[User] = relationship(back_populates="credential")


class DataKey(TimestampMixin, Base):
    """Обёртка ключа данных: зашифрованный DEK.

    Их две: одна открывается паролем, другая — ключом восстановления. Сам
    ключ данных на сервер не попадает никогда, поэтому смена пароля стоит
    перешифровки тридцати двух байт, а не всех блобов.
    """

    __tablename__ = "data_keys"
    __table_args__ = (CheckConstraint("kind IN ('password', 'recovery')", name="kind"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    kind: Mapped[str] = mapped_column(String(16), primary_key=True)

    # nonce ‖ шифротекст ‖ тег — одной строкой байтов, как и блобы: nonce
    # не секрет, но и смысла отдельного столбца у него нет.
    wrapped: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    user: Mapped[User] = relationship(back_populates="data_keys")


class Consent(Base):
    """Чем подтверждается основание обработки.

    Версии трёх документов, время и IP — ровно то, чем оператор доказывает
    получение согласия (ч. 1 ст. 9 152-ФЗ). Текстов здесь нет: они лежат в
    `docs/legal/`, и по версии с хэшем всегда видно, с чем именно человек
    согласился.

    `TimestampMixin` здесь не нужен: `accepted_at` — и есть время события, а
    менять запись о согласии нельзя, её можно только дополнить новой.
    """

    __tablename__ = "consents"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    policy_version: Mapped[str] = mapped_column(String(32), nullable=False)
    consent_version: Mapped[str] = mapped_column(String(32), nullable=False)
    terms_version: Mapped[str] = mapped_column(String(32), nullable=False)

    accepted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    # INET, а не строка: это адрес, а не текст, и база умеет его проверять.
    # Пусто, если адрес не удалось определить, — врать в такой записи хуже,
    # чем признать пробел.
    ip: Mapped[str | None] = mapped_column(INET, nullable=True)

    user: Mapped[User] = relationship(back_populates="consents")
