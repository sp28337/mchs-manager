/**
 * Слова для человека — в одном месте, отдельно от кода.
 *
 * Отказ сервера приходит машинным кодом (раздел 6 контракта), и
 * переводить его в слова должен экран, а не движок. Собраны они здесь,
 * чтобы правка формулировки не требовала открывать логику, а логика не
 * знала о словах.
 */

import { isApiError, isNetworkError, type ProblemCode } from "../api/errors";
import { CryptoKeyMismatchError, RecoveryKeyError } from "../crypto";

const ПО_КОДУ: Partial<Record<ProblemCode, string>> = {
  validation_failed: "Сервер не принял данные формы. Проверьте адрес почты.",
  email_taken: "На этот адрес уже есть учётная запись. Войдите или восстановите доступ.",
  bad_credentials: "Неверный адрес или пароль.",
  email_not_verified: "Сначала подтвердите адрес почты по ссылке из письма.",
  token_expired: "Ссылка устарела. Запросите новую.",
  token_revoked: "Ссылка больше не действует. Запросите новую.",
  consent_required:
    "Документы обновились. Откройте политику и согласие и примите новую редакцию.",
  resync_required: "Данные выбираются заново — это займёт мгновение.",
  item_too_large: "Один из графиков слишком большой для синхронизации.",
  quota_exceeded: "Место, отведённое учётной записи, кончилось.",
  rate_limited: "Слишком много попыток. Подождите и попробуйте снова.",
  service_unavailable: "Сервер сейчас недоступен. Попробуйте позже.",
  internal_error: "На сервере что-то пошло не так. Попробуйте позже.",
};

/** Человеческое объяснение любой нашей ошибки. */
export function explain(error: unknown): string {
  if (isNetworkError(error)) {
    return "Нет связи с сервером. Приложение работает как обычно, синхронизация подождёт.";
  }

  if (error instanceof RecoveryKeyError) return error.message;

  if (error instanceof CryptoKeyMismatchError) {
    return "Не удалось расшифровать данные этим паролем.";
  }

  if (isApiError(error)) {
    return ПО_КОДУ[error.code] ?? "Сервер ответил отказом. Попробуйте позже.";
  }

  return "Не получилось. Попробуйте ещё раз.";
}
