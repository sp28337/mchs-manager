"""Лимиты и квоты из раздела 7 контракта — и счётчик обращений.

Числа собраны в одном месте не для красоты: они обещаны в контракте, на
них рассчитывает фронт, и разъехаться они не должны.
"""

from __future__ import annotations

import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from math import ceil

#: Источник времени. Подменяется в тестах, чтобы не ждать окно вживую.
Clock = Callable[[], float]

# --- Размеры ---------------------------------------------------------------

#: Размер одного блоба. Год смен с отпусками и заметками — 50–200 КиБ.
MAX_BLOB_BYTES = 1024 * 1024

#: Элементов в одной отправке: запрос обозрим, откат дешёв.
MAX_ITEMS_PER_PUSH = 50

#: Тело запроса целиком — отсечка до разбора JSON.
MAX_BODY_BYTES = 8 * 1024 * 1024

#: Элементов на аккаунт: профилей у человека единицы, 200 — с запасом.
MAX_ITEMS_PER_ACCOUNT = 200

#: Объём аккаунта с историей. Выше — разговор с человеком, а не рост молчком.
MAX_ACCOUNT_BYTES = 50 * 1024 * 1024

#: Страница выборки изменений.
PAGE_SIZE = 50


# --- Частота ---------------------------------------------------------------


@dataclass(frozen=True)
class Limit:
    """Сколько обращений за сколько секунд."""

    requests: int
    seconds: int


#: `POST /sync` — на аккаунт.
SYNC = Limit(requests=60, seconds=60)

#: `POST /auth/login` — на пару (аккаунт, адрес IP). Защита от перебора.
LOGIN = Limit(requests=10, seconds=15 * 60)

#: `POST /auth/register` — на адрес IP.
REGISTER = Limit(requests=5, seconds=60 * 60)

#: `POST /auth/params` — на адрес IP. Защита от перебора адресов.
PARAMS = Limit(requests=30, seconds=60)


class RateLimiter:
    """Скользящее окно в памяти процесса.

    Хранит время обращений по ключу и отвечает, сколько ждать, если их
    стало больше дозволенного.

    **Чего этот счётчик не умеет.** Он в памяти одного процесса: при
    нескольких рабочих процессах каждый считает своё, и настоящий предел
    получается кратно выше заявленного. Для защиты от перебора пароля этого
    мало, и на шаге 13, когда появятся несколько процессов, счётчик
    переедет в общее хранилище. Пока процесс один, а заявленный предел
    соблюдается точно.

    Память не растёт бесконтрольно: просроченные отметки выкидываются при
    обращении к ключу, а когда ключей становится слишком много — у всех
    сразу.
    """

    #: Сколько ключей держим, прежде чем пройтись по всем и выкинуть пустые.
    SWEEP_AT = 10_000

    def __init__(self, clock: Clock | None = None) -> None:
        self._clock = clock or time.monotonic
        self._hits: dict[str, deque[float]] = {}

    def hit(self, key: str, limit: Limit) -> int | None:
        """Отметить обращение.

        Возвращает `None`, если можно, и число секунд до следующей попытки,
        если предел исчерпан. Отметка в последнем случае не ставится: иначе
        тот, кто долбит в закрытую дверь, продлевал бы себе запрет
        бесконечно.
        """
        now = self._clock()
        edge = now - limit.seconds

        hits = self._hits.setdefault(key, deque())
        while hits and hits[0] <= edge:
            hits.popleft()

        if len(hits) >= limit.requests:
            # Освободится, когда самая старая отметка выйдет из окна.
            # Округление вверх: ответить «подожди 0 секунд» — значит
            # пригласить на повторную попытку, которая снова упрётся.
            return max(1, ceil(hits[0] + limit.seconds - now))

        hits.append(now)

        if len(self._hits) > self.SWEEP_AT:
            self._sweep(edge)

        return None

    def reset(self) -> None:
        """Забыть всё. Нужно тестам, в бою не вызывается."""
        self._hits.clear()

    def _sweep(self, edge: float) -> None:
        for key in list(self._hits):
            hits = self._hits[key]
            while hits and hits[0] <= edge:
                hits.popleft()
            if not hits:
                del self._hits[key]
