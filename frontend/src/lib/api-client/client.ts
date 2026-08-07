/**
 * FE007 — типизированный HTTP-клиент.
 *
 * DoD задачи: «клиент добавляет `Authorization` и `Idempotency-Key` к
 * POST-запросам». Оба — требования `openapi.yaml`, и оба здесь, потому что
 * это единственное место, где их нельзя забыть.
 *
 * --- Об идемпотентности ------------------------------------------------
 *
 * Ключ генерируется НЕ здесь, а передаётся вызывающим (`IdempotencyKey`).
 * Разница существенна: ключ, созданный внутри `post()`, менялся бы при
 * каждом повторе, то есть означал бы «это другая операция» — ровно
 * наоборот тому, ради чего заголовок существует. Повтор после сетевого
 * сбоя обязан нести ТОТ ЖЕ ключ, и знает об этом только тот, кто держит
 * состояние формы.
 *
 * Умолчание всё же есть — `crypto.randomUUID()` для вызовов без ключа, —
 * и оно безопасно ровно потому, что применяется к одиночному вызову без
 * повторов. Компонент, который может повторить, обязан ключ передать
 * (см. `IdempotentActionButton`).
 *
 * --- О сервере и клиенте ------------------------------------------------
 *
 * Одна функция на оба окружения. Токен приходит аргументом, а не читается
 * из глобального состояния: в Server Component его даёт `cookies()`, в
 * браузере — провайдер сессии, и модуль, знающий про оба способа, был бы
 * непереносим ни в одно из них.
 */

import { ApiError, toApiError } from "./problem";

export type IdempotencyKey = string;

export interface RequestOptions {
  /** Bearer-токен. Без него `Authorization` не добавляется. */
  token?: string | null;
  /** Ключ идемпотентности для POST/PATCH/PUT. */
  idempotencyKey?: IdempotencyKey;
  signal?: AbortSignal;
  /** Параметры строки запроса; `undefined` и `null` опускаются. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Next.js-специфичные опции кеширования для Server Components. */
  next?: { revalidate?: number | false; tags?: string[] };
  cache?: RequestCache;
}

const DEFAULT_SERVER_BASE_URL = "http://127.0.0.1:8000/api/v1";

/**
 * Путь, по которому браузер обращается к API. Это СВОЙ origin: запрос
 * проксируется `rewrites` в `next.config.ts`.
 *
 * Так сделано не ради красоты. Прямой запрос из браузера на другой порт
 * — межисточниковый, и без заголовков CORS браузер его блокирует; на
 * экране это выглядит как «сервер недоступен», хотя сервер отвечает.
 * Единственный origin снимает вопрос целиком.
 */
const BROWSER_BASE_PATH = "/api/backend";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function apiBaseUrl(): string {
  // `window` есть только в браузере: на сервере ходим напрямую, минуя
  // собственный прокси, — лишний сетевой прыжок к самому себе ничего не
  // даёт.
  if (typeof window !== "undefined") return BROWSER_BASE_PATH;
  return process.env.API_BASE_URL ?? DEFAULT_SERVER_BASE_URL;
}

function buildUrl(path: string, query: RequestOptions["query"]): string {
  const base = apiBaseUrl();
  const joined = path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
  // В браузере база относительная, и `new URL` требует основы; на
  // сервере она абсолютная и основа игнорируется.
  const url = new URL(
    joined,
    typeof window !== "undefined" ? window.location.origin : undefined,
  );
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function request<TResponse>(
  method: string,
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<TResponse> {
  const headers = new Headers({ Accept: "application/json" });

  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (MUTATING_METHODS.has(method)) {
    headers.set("Idempotency-Key", options.idempotencyKey ?? crypto.randomUUID());
  }

  const response = await fetch(buildUrl(path, options.query), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options.signal,
    cache: options.cache,
    ...(options.next ? { next: options.next } : {}),
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  // 204 и пустое тело — законный ответ на команду, не приводящую к
  // представлению. Разбор `json()` на нём упал бы.
  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined as TResponse;
  }

  return (await response.json()) as TResponse;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("POST", path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PATCH", path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PUT", path, body, options),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>("DELETE", path, undefined, options),
};

export { ApiError };
export type { Problem } from "./problem";
