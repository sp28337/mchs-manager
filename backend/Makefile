.PHONY: lint format typecheck test test-integration up down migrate migrate-down \
        seed seed-personnel seed-calendar

migrate:
	alembic upgrade head

migrate-down:
	alembic downgrade base

# Dev/test fixtures only — see each script's docstring. Both idempotent.
# NOTE: seed-calendar produces a STATUTORY BASELINE for 2026 and leaves the
# year unpublished on purpose — the Government transfer decree is not applied.
seed: seed-personnel seed-calendar

seed-personnel:
	python -m scripts.seed_personnel_dev

seed-calendar:
	python -m scripts.seed_calendar_2026

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
