"""0018_regional_forecast_projection

CO013: read-модель `regional_compensation_forecast_projection`.

Таблицы нет в `PostgreSQL_Logical_Model_FPS.md` — она названа только в
бэклоге (CO013) и в `openapi.yaml`
(`GET /compensation/regions/{regionUnitId}/forecast` →
`RegionalCompensationForecast`). Схема выведена из этих двух источников:
поля ответа плюс ключ, по которому он адресуется.

--- Зачем проекция, если есть `compensation_line` ---------------------

Прогноз — это агрегат по ВСЕМ делам региона за период, то есть по всем
подразделениям всех уровней под региональным центром. Считать его
запросом означало бы на каждый просмотр дашборда обойти дела тысяч
сотрудников с соединением через `personnel.unit` по `ltree` — то самое,
от чего Architecture разд. 8.2 отделяет путь чтения.

Отсюда же следует, что проекция строится ПО РАСПИСАНИЮ, а не событием
(CO014, раз в сутки): цифра управленческая, её свежесть до минуты никому
не требуется, а перестроение проходит по всем регионам сразу и дешевле
одним проходом, чем тысячей инкрементов.

--- Почему два числа, а не одно ---------------------------------------

`forecast_monetary_hours` и `forecast_rest_days` — принципиально разные
величины, и складывать их нельзя: первая уйдёт в расчёт денежного
довольствия, вторая — в баланс ДДО (Алгоритм Л). Одно «итого» стёрло бы
ровно то различие, ради которого сотруднику даётся выбор формы
(ТК РФ ст. 152/153).

`forecast_rest_days` — в СУТКАХ, а не в часах: единица баланса ДДО —
сутки отдыха (Domain Model разд. 8.1), и пересчёт часов в сутки
выполняется при построении проекции, чтобы дашборд показывал ту же
величину, которой оперирует `rest_balance`.

Revision ID: 0018
Revises: 0017
Create Date: 2026-08-06
"""

from __future__ import annotations

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE compensation.regional_compensation_forecast_projection (
            -- Ссылка на personnel.unit регионального уровня, без FK
            -- (межсхемная, разд. 10).
            region_unit_id           uuid NOT NULL,
            period_start             date NOT NULL,
            period_end               date NOT NULL,
            forecast_monetary_hours  numeric(12,2) NOT NULL DEFAULT 0,
            forecast_rest_days       numeric(12,2) NOT NULL DEFAULT 0,
            employee_count           integer NOT NULL DEFAULT 0,
            case_count               integer NOT NULL DEFAULT 0,
            computed_at              timestamptz NOT NULL DEFAULT now(),

            CONSTRAINT pk_regional_forecast
                PRIMARY KEY (region_unit_id, period_start, period_end),
            CONSTRAINT ck_regional_forecast_period CHECK (period_end > period_start),
            CONSTRAINT ck_regional_forecast_non_negative CHECK (
                forecast_monetary_hours >= 0
                AND forecast_rest_days >= 0
                AND employee_count >= 0
                AND case_count >= 0
            )
        )
    """)
    # Основной паттерн доступа: «регион смотрит свой прогноз за период».
    # Первичного ключа для него достаточно — отдельный индекс был бы его
    # копией.
    op.execute("""
        CREATE INDEX ix_regional_forecast_period
            ON compensation.regional_compensation_forecast_projection (period_start DESC)
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE IF EXISTS compensation.regional_compensation_forecast_projection
    """)
