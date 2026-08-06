"""Composition/di.py — the "единственное место, компилирующее зависимость
от ВСЕХ модулей сразу" (Architecture разд. 8).

What it does: start each module's ORM mapping, and hand the validated
`Settings` to the shared infrastructure primitives in `building_blocks`.
That is all. It grows one module at a time and never invents infra a
module doesn't need yet.

What it deliberately does NOT do any more: provide `get_session` /
`get_rule_version_cache` to routers. Those moved to
`building_blocks/infrastructure/{db,redis_client}.py` and to each module's
own `api/dependencies.py`, because a module importing this file
transitively imports every other module — `.importlinter`'s
`independence-of-modules` contract failed on exactly that path as soon as
a second module existed. See `building_blocks/infrastructure/db.py` for
the full account.

The dependency now runs one way only: Composition -> modules -> building_blocks.
"""

from __future__ import annotations

from src.building_blocks.infrastructure.db import dispose_engine, init_engine
from src.building_blocks.infrastructure.outbox_tasks import register_outbox_table
from src.building_blocks.infrastructure.redis_client import dispose_redis, init_redis
from src.composition.settings import get_settings
from src.modules.compensation.infrastructure.orm_mapping import (
    outbox_message_table as compensation_outbox,
)
from src.modules.compensation.infrastructure.orm_mapping import (
    start_mappers as start_compensation_mappers,
)
from src.modules.legal_rules.infrastructure.write.orm_mapping import (
    outbox_message_table as legal_rules_outbox,
)
from src.modules.legal_rules.infrastructure.write.orm_mapping import (
    start_mappers as start_legal_rules_mappers,
)
from src.modules.personnel.infrastructure.orm_mapping import (
    outbox_message_table as personnel_outbox,
)
from src.modules.personnel.infrastructure.orm_mapping import (
    start_mappers as start_personnel_mappers,
)
from src.modules.rest_balance.infrastructure.orm_mapping import (
    outbox_message_table as rest_balance_outbox,
)
from src.modules.rest_balance.infrastructure.orm_mapping import (
    start_mappers as start_rest_balance_mappers,
)
from src.modules.scheduling.infrastructure.orm_mapping import (
    outbox_message_table as scheduling_outbox,
)
from src.modules.scheduling.infrastructure.orm_mapping import (
    start_mappers as start_scheduling_mappers,
)
from src.modules.service_calendar.infrastructure.orm_mapping import (
    outbox_message_table as service_calendar_outbox,
)
from src.modules.service_calendar.infrastructure.orm_mapping import (
    start_mappers as start_service_calendar_mappers,
)
from src.modules.time_accounting.infrastructure.write.orm_mapping import (
    outbox_message_table as time_accounting_outbox,
)
from src.modules.time_accounting.infrastructure.write.orm_mapping import (
    start_mappers as start_time_accounting_mappers,
)


def init_infrastructure() -> None:
    """Called once from `api_app.lifespan` at process startup — but also,
    in practice, once per `TestClient` instantiated in a test session,
    since each triggers its own lifespan startup/shutdown.

    Every call below is individually idempotent, which is what makes that
    repetition harmless: each module's `start_mappers()` tracks whether
    mapping already happened (SQLAlchemy raises on a second mapping of the
    same class, and integration test modules call it directly too), and
    `init_engine`/`init_redis` no-op when already initialized.
    """
    # One call per module — each owns its own `registry()`, so there is no
    # shared mapper configuration whose order would matter.
    start_legal_rules_mappers()
    start_personnel_mappers()
    start_service_calendar_mappers()
    start_scheduling_mappers()
    start_time_accounting_mappers()
    start_compensation_mappers()
    start_rest_balance_mappers()

    # Регистрация таблиц outbox в релее. Только Composition Root знает обо
    # всех модулях сразу, поэтому список живёт здесь, а не в
    # `building_blocks` (контракт `.importlinter` №3).
    for table in (
        legal_rules_outbox,
        personnel_outbox,
        service_calendar_outbox,
        scheduling_outbox,
        time_accounting_outbox,
        compensation_outbox,
        rest_balance_outbox,
    ):
        register_outbox_table(table)

    settings = get_settings()
    init_engine(dsn=settings.database_dsn, pool_size=settings.database_pool_size)
    init_redis(url=settings.redis_url)


async def dispose_infrastructure() -> None:
    """Called from `api_app.lifespan` at shutdown. Mappings are process-wide
    and are deliberately NOT torn down: unmapping and remapping the same
    classes across a `TestClient` restart is what SQLAlchemy refuses to do,
    while engine and Redis reconnect cleanly."""
    await dispose_engine()
    await dispose_redis()
