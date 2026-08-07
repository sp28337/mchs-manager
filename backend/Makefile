.PHONY: lint format typecheck test test-integration up down migrate migrate-down seed reset-db

migrate:
	alembic upgrade head

migrate-down:
	alembic downgrade base

# Dev/test fixtures only — see each script's docstring. Both idempotent.
# Производственный календарь 2026 года — единственные данные, которые
# приложению нужны для работы: норма периода считается по числу рабочих
# и предпраздничных дней. Скрипт строит УСТАВНУЮ основу и намеренно
# оставляет год неопубликованным: переносы выходных устанавливаются
# постановлением Правительства на каждый год отдельно, и подставлять их
# догадкой значило бы завысить норму.
seed:
	python -m scripts.seed_calendar_2026

# Сброс базы под новую цепочку миграций.
#
# Нужен ровно один раз — тем, у кого база осталась от прежней версии
# приложения. Разворот удалил семь модулей и заменил двадцать две
# миграции одной, поэтому `alembic upgrade head` на старой базе падает с
# «Can't locate revision identified by '0022'»: в `alembic_version`
# записана ревизия, которой в коде больше нет.
#
# Схемы, которые здесь удаляются, принадлежали продукту, которого больше
# нет. Данных, которые стоило бы переносить, в них не было.
reset-db:
	psql "$${FPS_DATABASE_DSN_SYNC:-postgresql://fps:fps@localhost:5432/fps_timekeeping}" \
		-v ON_ERROR_STOP=1 -f scripts/reset_schemas.sql
	alembic upgrade head

lint:
	ruff check .
	lint-imports

format:
	ruff format .

typecheck:
	mypy src

test:
	pytest tests/unit -v

test-integration:
	pytest tests/integration -v

up:
	docker compose up -d

down:
	docker compose down
