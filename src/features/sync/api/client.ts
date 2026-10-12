/**
 * Обращения к серверу синхронизации.
 *
 * --- Где живёт access-токен -----------------------------------------------
 *
 * В памяти этого объекта, и только в ней. Ни `localStorage`, ни
 * `sessionStorage`: оттуда его читает любой внедрённый скрипт, а живёт он
 * пятнадцать минут и восстанавливается по cookie, которую скрипты не
 * видят вовсе (`HttpOnly`). Перезагрузка страницы токен теряет — и это
 * правильно: первое же обращение обновит его само.
 *
 * --- Обновление токена делается один раз на всех --------------------------
 *
 * Отправка изменений и выборка идут рядом, и протухший токен они заметят
 * одновременно. Без общего обещания они пошли бы обновлять его вдвоём, а
 * сервер гасит семью токенов при повторном предъявлении — то есть второе
 * обновление выглядело бы кражей и выкинуло бы человека из аккаунта.
 * Поэтому обновление здесь одно: кто пришёл вторым, ждёт того же
 * обещания.
 *
 * --- Почему `credentials: "include"` ---------------------------------------
 *
 * В бою сервер стоит на том же домене, и cookie ушла бы и так. В
 * разработке фронт на 3000, API на 8000 — это один «сайт» (порт для
 * cookie не считается), но разные origin, и без явного `include` браузер
 * cookie не отправит. Одно слово здесь вместо двух разных веток кода на
 * бой и разработку.
 */

import { ApiError, NetworkError, type ProblemCode } from "./errors";

/**
 * Адрес API.
 *
 * По умолчанию свой домен (`/api/v1`) — так стоит в бою: nginx отдаёт
 * статику и проксирует `/api/`. В разработке адрес другой, потому что
 * фронт и сервер подняты отдельно, и задаётся он переменной окружения
 * сборки (`NEXT_PUBLIC_API_URL`, см. README).
 *
 * `||`, а не `??`: пустая строка — это тоже «не задано». Переменная
 * приходит из настроек сборки (в CI — `vars.API_URL`), а незаданная
 * переменная репозитория подставляется пустой строкой, и с `??` адресом
 * API стала бы пустота: все обращения ушли бы в корень сайта и получили
 * бы в ответ разметку страницы вместо JSON.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

const DEVICE_KEY = "shift-schedule.sync.device";

/**
 * Опознание устройства — случайный uuid, живёт в `localStorage`.
 *
 * Нужен журналу входов и семьям токенов (раздел 6 контракта): по нему
 * человек в будущем увидит «выйти на остальных устройствах», а сервер при
 * смене пароля оставит в деле то устройство, с которого её сделали.
 * Персональных данных в нём нет — это случайные байты.
 */
export function deviceId(): string {
  if (typeof window === "undefined") return "server";

  try {
    const saved = window.localStorage.getItem(DEVICE_KEY);
    if (saved !== null && /^[A-Za-z0-9._-]{1,64}$/.test(saved)) return saved;

    const fresh = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    // Приватное окно или запрет данных сайту: обойдёмся без постоянного
    // опознания, семьи токенов от этого не ломаются.
    return "neizvestnoe-ustrojstvo";
  }
}

const PROBLEM_CODES = new Set<string>([
  "validation_failed",
  "email_taken",
  "bad_credentials",
  "email_not_verified",
  "token_expired",
  "token_revoked",
  "consent_required",
  "resync_required",
  "item_too_large",
  "quota_exceeded",
  "rate_limited",
  "not_found",
  "method_not_allowed",
  "service_unavailable",
  "internal_error",
]);

/**
 * Чем ходить в сеть.
 *
 * Свой тип, а не `typeof fetch`: адрес здесь всегда строка (её собирает
 * сам клиент), и подделка в тесте не должна повторять три перегрузки
 * браузерного `fetch` ради одной.
 */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  /** Тело запроса — объект, уйдёт как JSON. */
  body?: unknown;
  /** Строка запроса. */
  query?: Record<string, string | number>;
  /** Запрос без access-токена: вход, регистрация, параметры, ссылки из писем. */
  anonymous?: boolean;
  /** Не пытаться обновить токен при `401` (чтобы не обновлять обновление). */
  noRefresh?: boolean;
  signal?: AbortSignal;
}

export class ApiClient {
  private token: string | null = null;
  private refreshing: Promise<unknown> | null = null;

  constructor(
    private readonly base: string = API_BASE,
    private readonly fetchImpl: Fetcher = (url, init) => fetch(url, init),
  ) {}

  /** Есть ли в памяти токен — то есть открыта ли сессия в этой вкладке. */
  get authorized(): boolean {
    return this.token !== null;
  }

  setAccessToken(token: string | null): void {
    this.token = token;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const first = await this.send(path, options);

    // Токен живёт пятнадцать минут, а вкладка — днями: `401` здесь
    // обычное дело, а не беда. Обновляемся и повторяем один раз.
    if (
      first.status === 401 &&
      !options.anonymous &&
      !options.noRefresh &&
      (await this.tryRefresh())
    ) {
      return this.unwrap<T>(await this.send(path, options));
    }

    return this.unwrap<T>(first);
  }

  /**
   * Обновить access-токен по cookie. Возвращает тело сессии.
   *
   * Обещание одно на всех, кто пришёл, пока оно не исполнилось, — и это
   * не оптимизация. Refresh-токен ротируется при каждом обновлении, а
   * предъявленный дважды сервер считает кражей и гасит всю семью токенов
   * (раздел 6 контракта). То есть два параллельных обновления — это не
   * «одно лишнее», а разлогиненный человек.
   *
   * Параллельными они бывают легко: продолжение сессии при открытии
   * страницы, отправка и выборка рядом, строгая проверка React, которая
   * монтирует эффекты дважды. Поэтому защита здесь, в одном месте, а не
   * в каждом вызывающем.
   */
  async refresh<T>(): Promise<T> {
    this.refreshing ??= this.request<unknown>("/auth/refresh", {
      method: "POST",
      anonymous: true,
      noRefresh: true,
    }).finally(() => {
      this.refreshing = null;
    });

    return (await this.refreshing) as T;
  }

  private async tryRefresh(): Promise<boolean> {
    try {
      const сессия = await this.refresh<{ access_token: string }>();
      this.token = сессия.access_token;
      return true;
    } catch {
      // Refresh тоже негоден: сессия кончилась, человеку придётся войти.
      this.token = null;
      return false;
    }
  }

  private async send(path: string, options: RequestOptions): Promise<Response> {
    const url = new URL(`${this.base}${path}`, globalThis.location?.origin ?? "http://api");

    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { "X-Device-Id": deviceId() };

    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (!options.anonymous && this.token !== null) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    try {
      return await this.fetchImpl(url.toString(), {
        method: options.method ?? "GET",
        headers,
        // Cookie с refresh-токеном: без этого браузер её не отправит.
        credentials: "include",
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (cause) {
      // `fetch` отвергает обещание только когда ответа НЕТ: нет сети,
      // запрос прерван, сервер не отозвался. Отказ сервера — это
      // ответ, и он разбирается ниже.
      throw new NetworkError(cause);
    }
  }

  private async unwrap<T>(response: Response): Promise<T> {
    if (response.ok) {
      // `204` у выхода, смены пароля и удаления аккаунта: тела нет вовсе.
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }

    throw await problem(response);
  }
}

async function problem(response: Response): Promise<ApiError> {
  let code: ProblemCode = "internal_error";
  let title: string | undefined;

  try {
    const body: unknown = await response.json();

    if (body !== null && typeof body === "object") {
      const данные = body as { code?: unknown; title?: unknown };
      if (typeof данные.code === "string" && PROBLEM_CODES.has(данные.code)) {
        code = данные.code as ProblemCode;
      }
      if (typeof данные.title === "string") title = данные.title;
    }
  } catch {
    // Не problem+json: так отвечает что-то между нами и сервером —
    // nginx, прокси в метро, страница-заглушка. Код остаётся общим.
  }

  const retryAfter = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);

  return new ApiError({
    code,
    status: response.status,
    title,
    retryAfter: Number.isNaN(retryAfter) ? null : retryAfter,
    requestId: response.headers.get("X-Request-Id"),
  });
}
