"""Согласие — по строке на документ, с хэшем текста

Раньше запись о согласии была одной строкой с тремя версиями: политика,
согласие и соглашение. Но согласие на обработку персональных данных обязано
быть оформлено отдельно от иных документов, которые человек подтверждает
(ч. 1 ст. 9 152-ФЗ), а оператор обязан доказать его получение (ч. 3 ст. 9).
По строке на три документа этого не показать: нельзя отделить согласие от
принятия соглашения, нельзя записать повторное принятие одного документа, не
переписывая остальные, и нет хэша текста.

Теперь одна строка — один документ: `kind`, `version`, `sha256`, `via`, время и
адрес. Прежние строки раскладываются на три: версии те же, время и адрес те
же, а хэша у них нет — тогда он не записывался, и выдумывать его задним числом
нельзя.

Откат — с потерей: от каждого документа остаётся последняя редакция, время и
адрес берутся от самой ранней записи человека.

Revision ID: b7705cef78f2
Revises: c3c6d524258d
Create Date: 2026-10-20 13:40:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7705cef78f2"
down_revision: str | Sequence[str] | None = "c3c6d524258d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Разложить строку на три и убрать столбцы с версиями."""
    op.add_column("consents", sa.Column("kind", sa.String(length=16), nullable=True))
    op.add_column("consents", sa.Column("version", sa.String(length=32), nullable=True))
    op.add_column("consents", sa.Column("sha256", sa.String(length=64), nullable=True))
    op.add_column(
        "consents",
        sa.Column(
            "via",
            sa.String(length=16),
            server_default="registration",
            nullable=False,
        ),
    )

    # Старые столбцы с версиями ещё обязательны, а новые строки их не заполняют:
    # на время переноса ограничение снимается, потом столбцы уходят вовсе.
    for столбец in ("policy_version", "consent_version", "terms_version"):
        op.alter_column("consents", столбец, nullable=True)

    # Прежняя строка становится строкой политики, а согласие и соглашение
    # добавляются рядом — в таком порядке, чтобы выборка «из строк политики» не
    # зацепила только что вставленные.
    op.execute("UPDATE consents SET kind = 'policy', version = policy_version")
    op.execute("""
        INSERT INTO consents (id, user_id, kind, version, via, accepted_at, ip)
        SELECT gen_random_uuid(), user_id, 'consent', consent_version,
               'registration', accepted_at, ip
        FROM consents
        WHERE kind = 'policy'
        """)
    op.execute("""
        INSERT INTO consents (id, user_id, kind, version, via, accepted_at, ip)
        SELECT gen_random_uuid(), user_id, 'terms', terms_version,
               'registration', accepted_at, ip
        FROM consents
        WHERE kind = 'policy'
        """)

    op.alter_column("consents", "kind", nullable=False)
    op.alter_column("consents", "version", nullable=False)
    # Умолчание нужно было только переносу: новые строки получают `via` от
    # приложения, и забытое значение должно быть ошибкой, а не тихой «регистрацией».
    op.alter_column("consents", "via", server_default=None)

    op.drop_column("consents", "policy_version")
    op.drop_column("consents", "consent_version")
    op.drop_column("consents", "terms_version")

    op.create_check_constraint(
        op.f("ck_consents_kind"), "consents", "kind IN ('policy', 'consent', 'terms')"
    )
    op.create_check_constraint(
        op.f("ck_consents_via"), "consents", "via IN ('registration', 'renewal')"
    )
    op.create_index(
        "ix_consents_user_id_kind_accepted_at",
        "consents",
        ["user_id", "kind", "accepted_at"],
        unique=False,
    )


def downgrade() -> None:
    """Собрать три строки обратно в одну — по последней редакции каждого документа."""
    op.drop_index("ix_consents_user_id_kind_accepted_at", table_name="consents")
    op.drop_constraint(op.f("ck_consents_via"), "consents", type_="check")
    op.drop_constraint(op.f("ck_consents_kind"), "consents", type_="check")

    # Новые столбцы в этот момент ещё обязательны, а собираемые строки их не
    # заполняют: ограничение снимается, сами столбцы уйдут в конце.
    for столбец in ("kind", "version", "via"):
        op.alter_column("consents", столбец, nullable=True)

    op.add_column(
        "consents", sa.Column("policy_version", sa.String(length=32), nullable=True)
    )
    op.add_column(
        "consents", sa.Column("consent_version", sa.String(length=32), nullable=True)
    )
    op.add_column(
        "consents", sa.Column("terms_version", sa.String(length=32), nullable=True)
    )

    op.execute("""
        CREATE TEMP TABLE _latest ON COMMIT DROP AS
        SELECT DISTINCT ON (user_id, kind) user_id, kind, version
        FROM consents
        ORDER BY user_id, kind, accepted_at DESC
        """)
    op.execute("""
        CREATE TEMP TABLE _first ON COMMIT DROP AS
        SELECT DISTINCT ON (user_id) user_id, accepted_at, ip
        FROM consents
        ORDER BY user_id, accepted_at ASC
        """)
    op.execute("DELETE FROM consents")
    op.execute("""
        INSERT INTO consents
            (id, user_id, policy_version, consent_version, terms_version,
             accepted_at, ip)
        SELECT gen_random_uuid(), f.user_id,
               max(l.version) FILTER (WHERE l.kind = 'policy'),
               max(l.version) FILTER (WHERE l.kind = 'consent'),
               max(l.version) FILTER (WHERE l.kind = 'terms'),
               f.accepted_at, f.ip
        FROM _first f
        JOIN _latest l USING (user_id)
        GROUP BY f.user_id, f.accepted_at, f.ip
        """)

    op.alter_column("consents", "policy_version", nullable=False)
    op.alter_column("consents", "consent_version", nullable=False)
    op.alter_column("consents", "terms_version", nullable=False)

    op.drop_column("consents", "via")
    op.drop_column("consents", "sha256")
    op.drop_column("consents", "version")
    op.drop_column("consents", "kind")
