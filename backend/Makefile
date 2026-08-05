.PHONY: lint format typecheck test test-integration up down migrate migrate-down seed

migrate:
	alembic upgrade head

migrate-down:
	alembic downgrade base

# Dev/test fixtures only — see the script's docstring. Idempotent.
seed:
	python -m scripts.seed_personnel_dev

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
