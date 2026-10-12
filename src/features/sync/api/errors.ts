/**
 * Ошибки обращения к серверу: две природы, и путать их нельзя.
 *
 * **Сеть не дошла** (`NetworkError`) — это не отказ, а отсутствие ответа:
 * метро, лифт, выключенный wi-fi. Приложение в этом случае работает как
 * всегда, синхронизация просто ждёт; человеку говорят «нет сети», а не
 * «ошибка».
 *
 * **Сервер ответил отказом** (`ApiError`) — у отказа есть машинный код из
 * раздела 6 контракта, и по коду приложение решает, что делать: просить
 * войти заново, подождать, выбрать всё с нуля. Текст для человека
 * выбирает экран, а не этот слой.
 */

/** Коды отказов из раздела 6 контракта. */
export type ProblemCode =
  | "validation_failed"
  | "email_taken"
  | "bad_credentials"
  | "email_not_verified"
  | "token_expired"
  | "token_revoked"
  | "consent_required"
  | "resync_required"
  | "item_too_large"
  | "quota_exceeded"
  | "rate_limited"
  | "not_found"
  | "method_not_allowed"
  | "service_unavailable"
  | "internal_error";

export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super("сеть недоступна");
    this.name = "NetworkError";
    this.cause = cause;
  }
}

export class ApiError extends Error {
  readonly code: ProblemCode;
  readonly status: number;
  /** `Retry-After` в секундах — приходит с `rate_limited`. */
  readonly retryAfter: number | null;
  /** `X-Request-Id`: по нему разбирают случай в журналах сервера. */
  readonly requestId: string | null;

  constructor(options: {
    code: ProblemCode;
    status: number;
    title?: string;
    retryAfter?: number | null;
    requestId?: string | null;
  }) {
    super(options.title ?? options.code);
    this.name = "ApiError";
    this.code = options.code;
    this.status = options.status;
    this.retryAfter = options.retryAfter ?? null;
    this.requestId = options.requestId ?? null;
  }
}

export function isApiError(error: unknown, ...codes: ProblemCode[]): error is ApiError {
  return error instanceof ApiError && (codes.length === 0 || codes.includes(error.code));
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}
