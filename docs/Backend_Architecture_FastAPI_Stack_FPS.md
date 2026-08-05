# Backend Architecture
## FastAPI + SQLAlchemy 2 + Alembic + Pydantic v2 + Redis + Celery

**Кода нет.** Документ показывает, как ранее спроектированные Domain Model, Architecture (Clean/DDD/VSA/CQRS), логическая модель PostgreSQL, Rule Engine и `openapi.yaml` ложатся на конкретный Python-стек. Синтаксис ключевых решений (Data Mapper через `registry.map_imperatively()` в SQLAlchemy 2.0, дискриминированные объединения Pydantic v2) сверен с Context7.

---

## 0. Как стек реализует уже принятые архитектурные решения

| Решение из предыдущих документов | Как реализуется в стеке |
|---|---|
| Domain-слой не должен зависеть от инфраструктуры (Clean Architecture) | Агрегаты — обычные Python-`dataclass`, **не** `SQLAlchemy Declarative`-классы и **не** `Pydantic BaseModel` |
| Один программный модуль = один bounded context, одна схема PostgreSQL | Один пакет `modules/<name>/`, один SQLAlchemy `MetaData`/`registry` с `schema="<name>"` |
| Между модулями — только `Contracts`, никогда не Domain/Infrastructure | `Contracts` — пакет с `typing.Protocol` и Pydantic-DTO, физически не импортирующий ничего из `domain`/`infrastructure` своего модуля |
| CQRS только в `TimeAccounting`/частично `Compensation` | Только эти модули имеют разделение `application/commands` и `application/queries` + отдельный `infrastructure/read` |
| Transactional Outbox | Таблица `outbox_message` в схеме модуля, запись в одной транзакции с агрегатом через ту же `AsyncSession` |
| Один и тот же монолит в ролях `Api`/`Workers` | Один и тот же пакет `src/`, два входа: `composition/api_app.py` (Uvicorn) и `composition/worker_app.py` (Celery) |
| `Formula`/`Condition` — дерево, не код | Pydantic v2 **дискриминированные объединения** (`Field(discriminator=...)`) — рекурсивная валидация дерева «из коробки», без ручного парсинга |

---

## 1. Структура проекта (верхний уровень)

```
backend/
├── pyproject.toml
├── alembic.ini
├── docker-compose.yml                 (Postgres, Redis, для локальной разработки)
│
├── src/
│   ├── building_blocks/               ← общий фундамент, без бизнес-смысла
│   │   ├── domain/
│   │   │   ├── entity.py               базовый класс Entity (id, __eq__ по id)
│   │   │   ├── aggregate_root.py       базовый AggregateRoot (буфер domain events)
│   │   │   ├── value_object.py         базовый frozen-dataclass VO
│   │   │   └── domain_event.py         базовый DomainEvent (occurred_at, event_id)
│   │   ├── application/
│   │   │   ├── command.py, query.py     Protocol-маркеры
│   │   │   ├── handler.py               Protocol CommandHandler/QueryHandler
│   │   │   └── pipeline/                сквозные behaviors: валидация, авторизация,
│   │   │                                 логирование, трассировка (не бизнес-логика)
│   │   └── infrastructure/
│   │       ├── unit_of_work.py          Protocol UnitOfWork (async context manager)
│   │       ├── event_bus.py             Protocol IEventBus
│   │       └── clock.py                 Protocol Clock (для тестируемости времени)
│   │
│   ├── modules/
│   │   ├── legal_rules/                 (см. разд. 2 — детальная анатомия модуля)
│   │   ├── personnel/
│   │   ├── service_calendar/
│   │   ├── scheduling/
│   │   ├── time_accounting/             ★ CQRS
│   │   ├── compensation/                ★ CQRS частично
│   │   ├── rest_balance/
│   │   └── leave_management/
│   │
│   ├── rule_engine/                     ← сквозной пакет, используется всеми модулями,
│   │   ├── schemas/                     но сам не является bounded context
│   │   │   ├── condition.py              Pydantic-модели Condition (discriminated union)
│   │   │   ├── formula.py                Pydantic-модели Formula (discriminated union)
│   │   │   └── action.py                 Pydantic-модели Action
│   │   ├── interpreter/
│   │   │   ├── tree_walker.py            рекурсивный вычислитель Formula/Condition
│   │   │   └── version_resolver.py       поиск применимой RuleVersion по scope+дате
│   │   └── function_registry/
│   │       ├── arithmetic.py             + - * / min max round ceil floor
│   │       ├── calendar_functions.py     working_days_count, pre_holiday_days_count
│   │       └── registry.py               реестр: имя функции → callable, ФИКСИРОВАН
│   │
│   └── composition/                     ← единственное место, знающее обо всех модулях
│       ├── settings.py                   pydantic-settings BaseSettings (DSN, Redis URL, JWT)
│       ├── di.py                         сборка контейнера зависимостей (порт → реализация)
│       ├── api_app.py                    FastAPI(); include_router() каждого модуля
│       ├── worker_app.py                 Celery(); include задачи каждого модуля
│       └── beat_schedule.py              периодические задачи (outbox relay, recalculation)
│
├── migrations/                          ← Alembic, единая линейная история (см. разд. 5)
│   ├── env.py
│   └── versions/
│       ├── 0001_legal_rules_initial.py
│       ├── 0002_personnel_initial.py
│       └── ...
│
└── tests/
    ├── unit/<module>/domain/            без БД, без FastAPI, чистый Python
    ├── unit/<module>/application/        с fake-реализацией портов
    ├── integration/<module>/             реальная Postgres/Redis (testcontainers)
    └── contract/                         schemathesis против openapi.yaml
```

---

## 2. Анатомия одного модуля (на примере `time_accounting` — CQRS-модуль)

```
modules/time_accounting/
├── domain/
│   ├── timesheet.py                    AggregateRoot Timesheet (dataclass, без импортов
│   │                                    SQLAlchemy/Pydantic — правило Clean Architecture)
│   ├── service_time_event.py           Entity
│   ├── value_objects.py                TimeInterval, HoursBreakdown (frozen dataclass)
│   └── events.py                       ShiftActuallyPerformed, TimesheetApproved, ...
│
├── application/
│   ├── commands/
│   │   ├── register_actual_shift/
│   │   │   ├── command.py               RegisterActualShiftCommand (Pydantic, frozen)
│   │   │   ├── handler.py                оркестрация: repo.get → domain-метод → repo.save
│   │   │   └── validator.py              структурная валидация (форма запроса)
│   │   ├── register_sickness/
│   │   ├── attract_overtime/
│   │   ├── approve_timesheet/
│   │   └── reopen_timesheet/
│   └── queries/
│       ├── get_my_timesheet_summary/
│       │   ├── query.py
│       │   └── handler.py               читает НЕ агрегат, а Read-модель (разд. 3.2)
│       ├── get_hours_breakdown_history/
│       └── get_unit_timesheet_dashboard/
│
├── infrastructure/
│   ├── write/
│   │   ├── orm_mapping.py               SQLAlchemy Table + registry.map_imperatively()
│   │   │                                (Data Mapper — Domain-класс мапится императивно,
│   │   │                                 сам класс Timesheet ничего не знает о SQLAlchemy)
│   │   ├── timesheet_repository.py      реализация Protocol из application/
│   │   └── outbox_writer.py             запись в outbox_message в той же транзакции
│   ├── read/
│   │   ├── projection_tables.py         SQLAlchemy-модели read-проекций (могут быть
│   │   │                                 обычным Declarative — сюда Data Mapper не нужен,
│   │   │                                 это не агрегат, а плоская витрина)
│   │   ├── projection_builder.py        Celery-задача: событие → обновление проекции
│   │   └── redis_cache.py               кэш «горячих» сводок (см. разд. 4.1)
│   └── tasks.py                         регистрация Celery-задач модуля
│
├── api/
│   ├── router.py                        FastAPI APIRouter, префикс /time-accounting
│   ├── schemas/                          Pydantic-модели запрос/ответ — зеркало DTO
│   │                                     из openapi.yaml (см. разд. 6)
│   └── dependencies.py                   FastAPI Depends: сессия БД, текущий пользователь
│
└── contracts/
    ├── get_timesheet_status.py           Protocol + Pydantic DTO, публично для Compensation
    └── integration_events.py             TimesheetApproved как публичное событие
```

**Правило, применяемое механически ко всем восьми модулям:** `domain/` не импортирует ничего из `application/infrastructure/api`; `api/` не импортирует ничего из `domain/` напрямую — только из `application/`; другой модуль может импортировать только `contracts/`.

---

## 3. SQLAlchemy 2 — как сохраняется чистота Domain-слоя

### 3.1 Data Mapper, а не Active Record
Домен (например, `Timesheet`) — простой `@dataclass`, определённый в `domain/timesheet.py`. Он **не наследуется** от `DeclarativeBase` и не содержит `Mapped`/`mapped_column`. Связь с таблицей устанавливается **императивно**, в `infrastructure/write/orm_mapping.py`, через `registry.map_imperatively(Timesheet, timesheet_table, properties={...})` — паттерн, подтверждённый документацией SQLAlchemy 2.0 (Context7) именно для случаев, когда доменный класс должен оставаться независимым от ORM.

Это даёт:
- Domain-тесты (Domain Model, разд. модульные тесты агрегатов) выполняются **без** подключения к БД и без импорта SQLAlchemy вообще.
- Возможность заменить SQLAlchemy на другой инструмент персистентности без изменения ни одной строки в `domain/`.

### 3.2 Где Declarative-стиль (`DeclarativeBase`/`Mapped`) уместен
Для **read-моделей** (CQRS-проекций, например `hours_breakdown_projection`) — обычный `DeclarativeBase`-класс, без Data Mapper: это не агрегат с инвариантами, а плоская витрина, которую не жалко напрямую завязать на ORM.

### 3.3 Async-режим
Везде — `AsyncSession`/`create_async_engine` (SQLAlchemy 2.0 asyncio-расширение), так как FastAPI, Celery-воркеры (через `asyncio.run` в задаче) и высокая читающая нагрузка (1 000 000+ пользователей, Architecture разд. 12) требуют неблокирующего I/O на уровне доступа к БД.

### 3.4 Схемы
Каждый модуль — свой `registry()`/`MetaData(schema="time_accounting")` и т.д., как и было спроектировано в логической модели PostgreSQL. Отсутствие межсхемных `ForeignKey` (документ PostgreSQL, разд. 10) означает, что `orm_mapping.py` одного модуля физически не может сослаться на таблицу другого модуля — импорт даже не скомпилируется без явного нарушения границ пакетов, что дополнительно проверяется линтером архитектурных границ (`import-linter`/аналог) в CI.

---

## 4. Redis — три независимых назначения (разделены логически, не смешиваются)

| Назначение | Где используется | Особенность конфигурации |
|---|---|---|
| **Кэш справочных данных** | `legal_rules` (`GetEffectiveRuleVersion`), `service_calendar` | Инвалидация по событию (`RuleVersionPublished`, `CalendarYearPublished`), а не только по TTL — устаревшие данные недопустимы даже кратковременно (норма/коэффициент не может «протухнуть» неправильно) |
| **Кэш read-проекций CQRS** | `time_accounting`, `compensation` (аналитика) | TTL короткий (секунды-минуты) + принудительная инвалидация по тегу ресурса при пересчёте (Алгоритм М) |
| **Брокер и result backend Celery** | Все Celery-задачи | В продуктивном контуре — **отдельный** Redis-инстанс (или хотя бы отдельная логическая БД `SELECT n`), чтобы пиковая нагрузка очереди задач не вытесняла закэшированные горячие данные |
| **Хранилище `Idempotency-Key`** | Все командные эндпоинты (см. документ API Conventions) | Короткий TTL (24 часа), значение — сериализованный ответ первого выполнения |
| **Ограничение частоты запросов (rate limiting)** | Публичные read-эндпоинты самообслуживания | Классический token-bucket поверх Redis, необходим именно из-за масштаба 1 000 000+ пользователей |
| **Шина интеграционных событий (реализация `IEventBus`)** | Outbox relay → потребители-проекции | Redis Streams (`XADD`/`XREADGROUP`) — конкретная реализация абстрактного порта `event_bus.py` из `building_blocks/infrastructure`; при необходимости позже заменяется на полноценный брокер без изменения кода модулей, так как модули знают только про `Protocol IEventBus` |

---

## 5. Alembic

**Единая линейная история миграций** (не отдельная история на схему) — так как физически это одна база PostgreSQL и порядок применения между схемами (например, `personnel` должна существовать раньше, чем `time_accounting` сможет создать логическую — не FK, но по порядку разработки) важен и должен быть явным.

**`env.py` — асинхронный режим:** конфигурация Alembic использует `run_sync`-обёртку над `AsyncEngine` (стандартный паттерн для проектов на SQLAlchemy 2.0 asyncio) — миграции пишутся и применяются синхронно относительно самого процесса Alembic, но целевая БД доступна тем же async-драйвером, что и приложение.

**`target_metadata` — составной:** собирается как объединение `MetaData` каждого модуля (`legal_rules.metadata`, `personnel.metadata`, ...), чтобы `alembic revision --autogenerate` видел все схемы разом, но **автогенерацию нельзя слепо принимать**:
- `EXCLUDE USING GIST` (пересечение интервалов, см. логическую модель PostgreSQL) — Alembic autogenerate **не** умеет создавать такие ограничения автоматически из отражения моделей; они дописываются вручную в теле миграции (`op.execute(...)`).
- Расширения (`btree_gist`, `ltree`, `pgcrypto`) — включаются один раз в первой миграции, вручную.
- Частичные уникальные индексы (например, «отпуск по личным обстоятельствам не более раза») — тоже дописываются вручную, autogenerate их не воспроизведёт корректно без ручной проверки условия `WHERE`.

**Именование:** `NNNN_<module>_<краткое_описание>.py` — по модулю видно, какая команда/разработчик отвечает за миграцию, не создавая при этом раздельных веток истории.

---

## 6. Pydantic v2 — три разных назначения, не смешиваемые

### 6.1 API-слой (`api/schemas`) — контракт HTTP
Прямое зеркало `openapi.yaml`. `model_config = ConfigDict(frozen=True, extra="forbid")` — `extra="forbid"` реализует то же требование строгости, что подразумевает `openapi.yaml` (никаких лишних полей). FastAPI генерирует свою OpenAPI-схему из этих моделей автоматически — в CI есть шаг, сверяющий сгенерированную схему с эталонным `openapi.yaml` (контракт всё ещё считается спроектированным заранее, а не производным от кода, — это решение уже было закреплено при разработке `openapi.yaml`).

### 6.2 Rule Engine (`rule_engine/schemas`) — рекурсивные деревья
`Condition` и `Formula` — ровно тот случай, для которого Pydantic v2 подходит лучше всего: **дискриминированное объединение** (`Union[...] = Field(discriminator="node_type")`), синтаксис подтверждён документацией Pydantic (Context7). Каждый вариант узла (`literal`, `variable`, `operator`, `function`, `conditional`, `rule_reference` для `Formula`; `leaf`, `composite` для `Condition`) — отдельная Pydantic-модель с `Literal["..."]`-полем `node_type`, а рекурсия (`args: list[Formula]`) выражается почти буквально тем же способом, что описан в документе Rule Engine — только теперь это не абстрактная JSON-схема, а конкретный, валидируемый на лету Python-тип.

### 6.3 Настройки (`composition/settings.py`)
`pydantic-settings.BaseSettings` — переменные окружения (DSN БД, URL Redis, публичный ключ проверки JWT, `broker_url`/`result_backend` Celery) валидируются при старте процесса, а не «в рантайме где-то посередине».

**Что Pydantic НЕ используется:** доменные агрегаты и Value Objects (раздел 3.1) — принципиально, чтобы Domain-слой не зависел даже от библиотеки валидации, не говоря об ORM/фреймворке.

---

## 7. Celery — организация задач и очередей

### 7.1 Роли задач по модулям

| Модуль | Задача | Очередь | Триггер |
|---|---|---|---|
| `time_accounting` | `relay_outbox` | `outbox` | Celery beat, каждые N секунд |
| `time_accounting` | `rebuild_hours_breakdown_projection` | `projections` | Событие `ShiftActuallyPerformed`/`TimesheetApproved` из Redis Streams |
| `compensation` | `create_compensation_case_from_event` | `projections` | Событие `TimesheetApproved` |
| `rest_balance` | `accrue_rest_days` | `projections` | Событие `CompensationLineCreated` |
| `legal_rules` | `dry_run_rule_version` | `analysis` | По запросу пользователя (POST `/dry-run`), выполняется асинхронно — потенциально тяжёлая операция по историческим данным |
| `time_accounting`/любой модуль | `retroactive_recalculation` | `recalculation` | По запросу (Алгоритм М), низкий приоритет очереди |
| Любой модуль | `send_notification` (email/push о готовности расчёта) | `notifications` | Различные события |

### 7.2 Почему очереди разделены (`task_routes`)
Массовый пересчёт (`recalculation`) или тяжёлый dry-run (`analysis`) не должны задерживать быстрые, частые задачи построения проекций (`projections`) — иначе сотрудник, ожидающий обновления своей сводки после регистрации смены, будет ждать за одноразовым историческим пересчётом другого подразделения. Разделение очередей — прямое отражение принципа Architecture (разд. 12.2): «горячий путь» не должен конкурировать с редкими тяжёлыми операциями за одни и те же воркеры.

### 7.3 Совместное развёртывание (Architecture, разд. 11–12, теперь конкретно)
```
Один и тот же образ (кодовая база backend/) запускается как:

  uvicorn composition.api_app:app             → роль Api
  celery -A composition.worker_app worker -Q projections,outbox   → роль Workers (быстрые)
  celery -A composition.worker_app worker -Q recalculation,analysis → роль Workers (медленные)
  celery -A composition.worker_app beat        → планировщик периодических задач
```
Ни один из этих процессов не является отдельным «сервисом» в смысле микросервисов — это один и тот же `pyproject.toml`, одна и та же версия кода, просто разные точки входа и разные наборы очередей на инстанс, что позволяет масштабировать «медленные» и «быстрые» воркеры независимо друг от друга без изменения архитектуры.

---

## 8. FastAPI — сборка приложения (Composition Root)

`composition/api_app.py` — единственное место, которое:
1. Создаёт `FastAPI()` и подключает `router` каждого модуля (`app.include_router(time_accounting_router, prefix="/api/v1/time-accounting")`), в точности повторяя пути `openapi.yaml`.
2. Регистрирует общие `Depends`: получение `AsyncSession` (per-request, из пула конкретной схемы или общего пула с `search_path`), получение текущего пользователя из JWT (роли, `unit_scope` — см. документ API Conventions), rate-limit-зависимость поверх Redis.
3. Регистрирует единый обработчик исключений, преобразующий доменные исключения (`DomainInvariantViolation`, `ImmutableResourceError`, кастомные исключения из `domain/`) в `application/problem+json` строго по каталогу кодов из документа API Conventions — то есть Domain по-прежнему не знает про HTTP, а маппинг «исключение → код ответа» находится **только** в Composition/API-слое.

`composition/di.py` — сборка конкретных реализаций портов (репозитории, `EventBus` на Redis Streams, `Clock`) и внедрение их в обработчики команд/запросов каждого модуля — единственное место, компилирующее зависимость от **всех** модулей сразу, как и предписано Architecture (разд. 6, «Composition — единственное место, знающее обо всех модулях»).

---

## 9. Сводная диаграмма стека

```
                        Composition Root
        (api_app.py — Uvicorn)      (worker_app.py — Celery)
                 │                            │
      ┌──────────┴───────────┐      ┌─────────┴──────────┐
      │  modules/*/api        │      │  modules/*/infrastructure/tasks │
      │  (FastAPI routers,     │      │  (Celery-задачи: outbox relay, │
      │   Pydantic-схемы)       │      │   построение проекций,          │
      └──────────┬───────────┘      │   пересчёт)                     │
                 │                   └─────────┬──────────┘
                 ▼                             ▼
      modules/*/application          modules/*/infrastructure/{write,read}
      (Command/Query handlers,                  │
       используют rule_engine                   ▼
       для вычислений через порты)     SQLAlchemy 2 (async) ──▶ PostgreSQL
                 │                             │
                 ▼                             ▼
      modules/*/domain                 Redis (кэш / брокер Celery /
      (чистый Python, без               Streams как шина событий /
       зависимостей от стека)            idempotency store / rate-limit)
```
