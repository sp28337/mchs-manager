"""Ревизия, начиная с которой история полна

Нужна для честного ответа устройству, которое не выходило на связь дольше,
чем живут надгробия (180 дней): его курсор указывает в стёртую часть
истории, и об удалениях оно не узнает. Вместо тихой потери сервер отвечает
`resync_required` — «выбирай всё с нуля» (раздел 4 контракта).

Поднимает её сборщик, когда убирает старые надгробия. Пока сборщик не
запущен по расписанию (шаг 13), значение остаётся нулём, и выборка с любого
курсора разрешена.

Revision ID: c3c6d524258d
Revises: 1368bfda0bf9
Create Date: 2026-10-11 16:59:52.655428

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3c6d524258d"
down_revision: str | Sequence[str] | None = "1368bfda0bf9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Добавить столбец."""
    op.add_column(
        "users",
        sa.Column(
            "min_rev_available",
            sa.BigInteger(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Убрать столбец."""
    op.drop_column("users", "min_rev_available")
