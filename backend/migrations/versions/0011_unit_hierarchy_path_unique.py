"""0011_unit_hierarchy_path_unique

Добавляет `uq_unit_hierarchy_path`, пропущенное в миграции 0006.

Схемы `personnel` и `service_calendar` проектировались до того, как
`PostgreSQL_Logical_Model_FPS.md` появился в репозитории (коммит
`add project docs`) — я ссылался на него в докстрингах, но самого файла не
имел. Сверка после его появления нашла ровно одно расхождение, которое
что-то реально ослабляет: разд. 2.2 требует
`CONSTRAINT uq_unit_hierarchy_path UNIQUE (hierarchy_path)`, и его не было.

Почему это важно, а не косметика. `hierarchy_path` — материализованный
путь, по которому отвечают все поддеревные запросы (`<@`), включая
проверку `unit_scope` при авторизации (API_Conventions разд. 2). Два
подразделения с одинаковым путём сделали бы каждый такой запрос
неверным — и неверным молча: запрос вернул бы лишние строки, а не ошибку.
Это ровно тот класс ошибки, из-за которого `HierarchyPath` в домене
строит метки из id подразделения, а не из его `code` (см. VO): при
метках из свободного текста коллизия достижима, при метках из id — нет.

То есть теперь инвариант держат обе стороны независимо: домен делает
коллизию непредставимой, БД её запрещает. Ограничение добавляется даже
при том, что текущая схема меток коллизию породить не может: оно защищает
не от сегодняшнего кода, а от завтрашнего решения вернуться к читаемым
путям из `code` — как раз к тем, что показаны примером в логической
модели (`'main_hq.region_77.detachment_12.station_4'`).

Revision ID: 0011
Revises: 0010
Create Date: 2026-08-05
"""

from __future__ import annotations

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE personnel.unit "
        "ADD CONSTRAINT uq_unit_hierarchy_path UNIQUE (hierarchy_path)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE personnel.unit DROP CONSTRAINT IF EXISTS uq_unit_hierarchy_path")
