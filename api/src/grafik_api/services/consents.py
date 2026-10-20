"""Согласие на обработку и принятие документов: что проверяется и что пишется.

--- Что требует закон -------------------------------------------------------

* Согласие должно быть конкретным, предметным, информированным, сознательным
  и однозначным, и оформлено **отдельно** от иных документов, которые
  подтверждает человек (ч. 1 ст. 9 152-ФЗ). В приложении это две отдельные
  отметки: «принимаю соглашение и политику» и «даю согласие на обработку».
* Доказывать получение согласия обязан оператор (ч. 3 ст. 9).

--- Что из этого следует для записи ----------------------------------------

Запрос на регистрацию обязан сообщить, что совершены ОБА действия, а не только
прислать версии: иначе сервер не знает, что человек вообще что-то отметил, и
запись говорила бы лишь «клиент прислал три версии». Явные признаки не
защищают от подделанного клиента — ничто не защищает, — но фиксируют действие в
контракте и в тестах, а отказ без них — это отказ, а не тихая запись.

В базу каждый документ пишется своей строкой с хэшем тела текста. Версия
называет редакцию, хэш подтверждает, что архивный текст тот самый.

Повторное принятие нужно только для согласия. Согласие должно быть конкретным,
предметным и информированным (ч. 1 ст. 9): оно покрывает ровно то, что названо
в его тексте — состав данных, цели, получателей, срок, — а новая обработка,
которой в нём нет, на нём держаться не может (ч. 2 ст. 5). Поэтому, когда текст
согласия меняется по существу, прежний ответ относится к прежнему тексту.

Остальные документы заново не спрашиваются. Политика — не согласие, а сведения,
которые оператор обязан опубликовать (ч. 2 ст. 18.1): её правка ответа не
требует. Соглашение — условия, которые меняются по порядку, записанному в нём
самом (раздел 11: новая редакция публикуется, продолжение пользования означает
согласие с ней). Состав данных и цели ни тем, ни другим не расширяются: они в
согласии, а значит, их изменение — это новая редакция согласия.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final, Literal

from grafik_api.core.errors import ConsentRequiredError
from grafik_api.core.legal import CURRENT_VERSIONS, LEGAL_DOCUMENTS
from grafik_api.models import Consent
from grafik_api.repositories import ConsentRepository

ConsentKind = Literal["policy", "consent", "terms"]
ConsentVia = Literal["registration", "renewal"]
#: Документ, чья новая редакция требует ответа заново.
RenewalKind = Literal["consent"]

#: Первое действие: принятие соглашения и политики (два документа, одна отметка).
TERMS_AND_POLICY: Final[tuple[ConsentKind, ...]] = ("terms", "policy")
#: Второе действие: согласие на обработку — отдельно от остальных (ч. 1 ст. 9).
PERSONAL_DATA: Final[tuple[ConsentKind, ...]] = ("consent",)

#: Документы, чья новая редакция требует ответа заново: только согласие.
#: Политика и соглашение сюда не входят — почему, сказано в начале модуля.
RENEWAL_KINDS: Final[tuple[RenewalKind, ...]] = ("consent",)


@dataclass(frozen=True)
class ConsentGiven:
    """Что человек сообщил при регистрации или повторном принятии."""

    policy_version: str
    consent_version: str
    terms_version: str
    #: Поставлена отметка «принимаю соглашение и политику».
    accepted_terms_and_policy: bool
    #: Поставлена отметка «даю согласие на обработку».
    accepted_personal_data: bool

    def version_of(self, kind: str) -> str:
        return {
            "policy": self.policy_version,
            "consent": self.consent_version,
            "terms": self.terms_version,
        }[kind]


def check(given: ConsentGiven) -> None:
    """Совершены оба действия и приняты действующие редакции.

    Старая редакция — не отказ навсегда: приложение покажет новый текст и
    спросит заново.
    """
    if not (given.accepted_terms_and_policy and given.accepted_personal_data):
        raise ConsentRequiredError(
            "обе отметки обязательны: соглашение с политикой и согласие на обработку",
            current=CURRENT_VERSIONS,
        )

    устарело = {
        вид: версия
        for вид, версия in (
            ("policy", given.policy_version),
            ("consent", given.consent_version),
            ("terms", given.terms_version),
        )
        if версия != CURRENT_VERSIONS[вид]
    }

    if устарело:
        raise ConsentRequiredError(
            "приняты не действующие редакции документов",
            current=CURRENT_VERSIONS,
        )


@dataclass(frozen=True)
class RenewalGiven:
    """Что человек сообщил при повторном принятии: одна отметка и версия."""

    consent_version: str
    #: Поставлена отметка «даю согласие на обработку».
    accepted_personal_data: bool


def check_renewal(given: RenewalGiven) -> None:
    """Отметка поставлена и принята действующая редакция согласия."""
    if not given.accepted_personal_data:
        raise ConsentRequiredError(
            "нужна отметка: согласие на обработку персональных данных",
            current=CURRENT_VERSIONS,
        )

    if given.consent_version != CURRENT_VERSIONS["consent"]:
        raise ConsentRequiredError(
            "принята не действующая редакция согласия",
            current=CURRENT_VERSIONS,
        )


def pending(latest: Sequence[Consent]) -> list[RenewalKind]:
    """Документы, на которые надо ответить заново.

    Получает последнюю принятую редакцию каждого документа. Документ, которого
    у человека вовсе нет, тоже ждёт ответа: это может быть строка, потерянная
    при переносе, и молчать о ней нельзя.
    """
    принято = {запись.kind: запись.version for запись in latest}

    return [вид for вид in RENEWAL_KINDS if принято.get(вид) != CURRENT_VERSIONS[вид]]


def record(
    consents: ConsentRepository,
    *,
    user_id: uuid.UUID,
    kinds: Sequence[ConsentKind],
    via: ConsentVia,
    accepted_at: datetime,
    ip: str | None,
) -> list[Consent]:
    """Записать принятие действующей редакции каждого из документов.

    Версия и хэш берутся из манифеста, а не из запроса: запрос лишь
    подтверждает, что человек видел действующую редакцию (`check`), а то, чем
    это доказывается, должно быть то, что сервер знает сам.
    """
    return [
        consents.create(
            user_id=user_id,
            kind=вид,
            version=LEGAL_DOCUMENTS[вид].version,
            sha256=LEGAL_DOCUMENTS[вид].sha256,
            via=via,
            accepted_at=accepted_at,
            ip=ip,
        )
        for вид in kinds
    ]
