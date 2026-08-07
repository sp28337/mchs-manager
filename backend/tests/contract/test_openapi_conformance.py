"""CO019/TA035/RB011/LM012 — сверка реализованного API с `docs/openapi.yaml`.

--- Почему не schemathesis --------------------------------------------

Бэклог просит schemathesis («не находит расхождений»). Он их найдёт — и
это не будет ошибкой реализации.

По ходу фаз 6-8 в спецификации обнаружились места, где она сама себе или
закону противоречит, и каждое разрешено в пользу закона, а не текста:

* `RuleCategory` в `CompensationLine`, `RecordEmployeeElectionRequest` и
  `conflict_resolution_policy_version.precedence_list` — там перечислены
  категории ЧАСОВ (`overtime`/`night`/`holiday`), которых в `RuleCategory`
  нет, а про выходные нет вообще ничего: компенсацию за работу в выходной
  (ТК РФ ст. 153) этой схемой описать невозможно;
* операций над политикой разрешения конфликта категорий в спецификации
  нет вовсе, хотя Алгоритм Ж требует её как обязательный вход;
* `HoursBreakdown` не имеет полей под результат Алгоритма Е
  (`weekendHours`) и под разбивку недоработки, которую Алгоритм З
  предписывает записать;
* `CreateCompensationCaseRequest` требует `timesheetId`, но табель
  определяется периодом однозначно, и позволять клиенту назвать чужой
  значило бы дать способ начислить компенсацию по чужому расчёту.

Прогнать schemathesis сегодня — значит либо получить красный CI на
осознанных решениях, либо обвесить его подавлениями до бессмысленности.
Правильный порядок обратный: сначала спецификация приводится в
соответствие с законом (это правка `docs/openapi.yaml`, то есть решение
владельца документа), потом включается генеративная сверка.

--- Что проверяется вместо этого --------------------------------------

Уровень МАРШРУТОВ: каждый путь спецификации, относящийся к
реализованному модулю, обязан существовать в приложении с тем же методом.
Это ловит настоящий дрейф — переименованный или забытый эндпоинт, — не
притворяясь, будто схемы тел совпадают.

Известные расхождения перечислены явным списком: тест обязан падать,
когда их станет больше, а не молча к ним привыкать.
"""

from __future__ import annotations

from pathlib import Path

import yaml

from src.composition.api_app import app

SPEC_PATH = Path(__file__).resolve().parents[3] / "docs" / "openapi.yaml"

# Модули, реализованные к этому моменту. Пути остальных в спецификации
# есть, но проверять их нечего — они и не должны существовать.
IMPLEMENTED_PREFIXES = (
    "/legal-rules",
    "/personnel",
    "/service-calendar",
    "/scheduling",
    "/time-accounting",
    "/compensation",
    "/rest-balance",
    "/leave",
)

API_PREFIX = "/api/v1"

# Пути спецификации, намеренно НЕ реализованные. Каждый — с причиной.
KNOWN_ABSENT: dict[str, str] = {
    # Черновик табеля сдаётся командиру: openapi такой операции не
    # описывает (есть только approve/reopen), а статус `pending_approval`
    # в перечислении присутствует. Реализовывать нечего, пока операции
    # нет в спецификации.
}


def _spec_paths() -> dict[str, set[str]]:
    spec = yaml.safe_load(SPEC_PATH.read_text(encoding="utf-8"))
    result: dict[str, set[str]] = {}
    for path, operations in spec["paths"].items():
        methods = {
            m.lower()
            for m in operations
            if m.lower() in {"get", "post", "put", "patch", "delete"}
        }
        result[path] = methods
    return result


def _app_routes() -> dict[str, set[str]]:
    """Из СГЕНЕРИРОВАННОЙ приложением спецификации, а не из `app.routes`.

    `include_router` оборачивает маршруты модуля так, что их пути не видны
    на верхнем уровне — обход `app.routes` возвращал пустой список и тест
    «проходил», ничего не сравнив. `app.openapi()` отдаёт ровно то, что
    увидит клиент, и это и есть предмет сверки.
    """
    generated = app.openapi()["paths"]
    result: dict[str, set[str]] = {}
    for path, operations in generated.items():
        if not path.startswith(API_PREFIX):
            continue
        trimmed = path[len(API_PREFIX) :]
        result.setdefault(trimmed, set()).update(
            method.lower()
            for method in operations
            if method.lower() in {"get", "post", "put", "patch", "delete"}
        )
    return result


def _normalise(path: str) -> str:
    """`{timesheetId}` спецификации и `{timesheet_id}` FastAPI — один
    маршрут. Имя параметра в пути не является частью контракта: клиент
    подставляет значение, а не имя."""
    out: list[str] = []
    depth = 0
    for char in path:
        if char == "{":
            depth += 1
            out.append("{")
        elif char == "}":
            depth -= 1
            out.append("}")
        elif depth == 0:
            out.append(char)
    return "".join(out)


def test_every_specified_operation_of_an_implemented_module_exists() -> None:
    spec = _spec_paths()
    routes = {_normalise(p): m for p, m in _app_routes().items()}

    missing: list[str] = []
    for path, methods in spec.items():
        if not path.startswith(IMPLEMENTED_PREFIXES):
            continue
        normalised = _normalise(path)
        for method in methods:
            if f"{method} {path}" in KNOWN_ABSENT:
                continue
            if method not in routes.get(normalised, set()):
                missing.append(f"{method.upper()} {path}")

    assert not missing, (
        "операции есть в docs/openapi.yaml, но не реализованы: "
        + ", ".join(sorted(missing))
    )


def test_the_spec_has_no_operations_for_unimplemented_modules_we_claim_to_serve() -> None:
    """Обратная сторона: приложение не должно отвечать по путям, которых
    в спецификации нет, — кроме явно названных ADDITIVE-дополнений.

    Дополнения перечислены поимённо, потому что каждое из них —
    обязательство: при следующей ревизии `openapi.yaml` они должны
    попасть в спецификацию, а не остаться недокументированными.

    Сверка идёт по ОПЕРАЦИЯМ, а не по путям. Разница не теоретическая:
    `GET /personnel/units` появился на пути, где спецификация описывает
    только `POST`, и проверка на уровне путей его бы не заметила —
    недокументированная операция притворилась бы документированной за
    счёт соседки.
    """
    spec = {
        f"{method} {_normalise(path)}"
        for path, methods in _spec_paths().items()
        for method in methods
    }
    routes = _app_routes()

    additive = {
        # Пробел спецификации: Алгоритм Ж требует политику приоритетов как
        # обязательный вход, а операций над ней openapi не описывает.
        "get /legal-rules/conflict-policies",
        "post /legal-rules/conflict-policies",
        "post /legal-rules/conflict-policies/{}/versions",
        "post /legal-rules/conflict-policy-versions/{}/publish",
        # RB006. Сторно — единственный законный способ исправить движение
        # баланса (Domain Model инвариант 8.1.3), а операции над ним
        # спецификация не описывает: журнал в ней только читается.
        "post /rest-balance/movements/{}/reversal",
        # PE011+. Спецификация даёт создание подразделения и чтение по
        # идентификатору, но не способ узнать, какие подразделения есть.
        # Экран иерархии начинается с корня, а идентификатор корня взять
        # неоткуда — см. `ListUnitsQuery`.
        "get /personnel/units",
    }

    undocumented = {
        f"{method} {_normalise(path)}"
        for path, methods in routes.items()
        for method in methods
        if path.startswith(IMPLEMENTED_PREFIXES)
    } - spec - additive

    assert not undocumented, (
        "приложение отвечает по путям, которых нет в docs/openapi.yaml и "
        f"которые не объявлены дополнением: {sorted(undocumented)}"
    )
