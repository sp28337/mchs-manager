.PHONY: lint format typecheck test up down migrate migrate-down

migrate:
	alembic upgrade head

migrate-down:
	alembic downgrade base

lint:
	ruff check .
	lint-imports

format:
	ruff format .

typecheck:
	mypy src

test:
	pytest tests/unit -v

up:
	docker compose up -d

down:
	docker compose down
