"""Вид элемента `appearance` — оформление в синхронизации

Цвета лампы и событий и выключатели лампы теперь едут между устройствами
вместе с аккаунтом (раздел 3 контракта). Для сервера это ещё один зашифрованный
блоб — единственный на аккаунт, с опознанием `appearance`, — но вид элемента
перечислен проверкой, и до этой миграции база отвергла бы его строку.

Проверка пересоздаётся, а не правится: у CHECK нет ALTER, только удалить и
завести заново. Существующие строки новому условию удовлетворяют — оно шире.

Откат: проверка возвращается прежней, а строки оформления перед этим
удаляются — иначе она не встала бы на таблицу с лишним видом. Это потеря, но
не данных человека: оформление вернётся с любого устройства, где оно лежит
(следующий проход синхронизации отправит его заново, если сервер снова его
примет), а прежняя версия приложения такого вида не читает вовсе.

Revision ID: 4f9a1c7e2b60
Revises: b7705cef78f2
Create Date: 2026-10-23 09:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4f9a1c7e2b60"
down_revision: str | Sequence[str] | None = "b7705cef78f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Допустить вид `appearance`."""
    op.drop_constraint(op.f("ck_blobs_kind"), "blobs", type_="check")
    op.create_check_constraint(
        op.f("ck_blobs_kind"),
        "blobs",
        sa.text("kind IN ('index', 'profile', 'appearance')"),
    )


def downgrade() -> None:
    """Вернуть прежний перечень видов, убрав строки оформления."""
    # История уходит каскадом (`ON DELETE CASCADE` у `blob_revisions`).
    op.execute("DELETE FROM blobs WHERE kind = 'appearance'")
    op.drop_constraint(op.f("ck_blobs_kind"), "blobs", type_="check")
    op.create_check_constraint(
        op.f("ck_blobs_kind"),
        "blobs",
        sa.text("kind IN ('index', 'profile')"),
    )
