/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClient, deviceId } from "./client";
import { ApiError, NetworkError } from "./errors";

/**
 * Обёртка над `fetch`: три решения, которые стоят проверки.
 *
 * Токен в памяти и обновление по cookie — то, чем сессия живёт сутками
 * при пятнадцатиминутном токене. Разбор `problem+json` — то, по чему
 * экран решает, что сказать человеку. Отличие «нет сети» от «сервер
 * отказал» — то, из-за чего человеку говорят «подождём» вместо «ошибка».
 */
function ответ(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function отказ(code: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ code, title: "отказ", status }), {
    status,
    headers: { "Content-Type": "application/problem+json", ...headers },
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("обращения к серверу", () => {
  it("опознание устройства ставится заголовком и переживает перезагрузку", async () => {
    const fetchImpl = vi.fn(async () => ответ({ ok: true }));
    const client = new ApiClient("https://api.test/api/v1", fetchImpl);

    await client.request("/sync");

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(headers["X-Device-Id"]).toBe(deviceId());
    expect(headers["X-Device-Id"]).toMatch(/^[A-Za-z0-9._-]{1,64}$/);
    // Cookie с refresh-токеном уходит только с этим.
    expect(init.credentials).toBe("include");
  });

  it("токен уходит в заголовке и только в нём", async () => {
    const fetchImpl = vi.fn(async () => ответ({}));
    const client = new ApiClient("https://api.test/api/v1", fetchImpl);
    client.setAccessToken("живой-токен");

    await client.request("/account");

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(headers.Authorization).toBe("Bearer живой-токен");
    expect(url).not.toContain("живой-токен");
  });

  it("на 401 токен обновляется один раз, и запрос повторяется", async () => {
    const fetchImpl = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockImplementationOnce(async () => отказ("token_expired", 401))
      .mockImplementationOnce(async () => ответ({ access_token: "свежий" }))
      .mockImplementationOnce(async () => ответ({ items: [] }));

    const client = new ApiClient("https://api.test/api/v1", fetchImpl);
    client.setAccessToken("протухший");

    const итог = await client.request<{ items: unknown[] }>("/sync");

    expect(итог).toEqual({ items: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    const [, повтор] = fetchImpl.mock.calls[2] as unknown as [string, RequestInit];
    expect((повтор.headers as Record<string, string>).Authorization).toBe("Bearer свежий");
  });

  it("два продолжения сессии обновляют токен одним обещанием", async () => {
    // Refresh-токен ротируется, а предъявленный дважды сервер считает
    // кражей и гасит семью: два параллельных обновления — это не «одно
    // лишнее», а разлогиненный человек. Так и случилось в браузере при
    // строгой проверке React, которая монтирует эффекты дважды.
    let обновлений = 0;
    const fetchImpl = vi.fn(async () => {
      обновлений += 1;
      await new Promise((готово) => setTimeout(готово, 5));
      return ответ({ access_token: "свежий" });
    });

    const client = new ApiClient("https://api.test/api/v1", fetchImpl);

    await Promise.all([client.refresh(), client.refresh()]);

    expect(обновлений).toBe(1);

    // Следующее обращение — уже новое обещание, а не то же самое.
    await client.refresh();
    expect(обновлений).toBe(2);
  });

  it("два запроса обновляют токен одним обещанием", async () => {
    // Повторное предъявление refresh-токена сервер считает кражей и
    // гасит всю семью: второе обновление выкинуло бы человека из
    // аккаунта.
    let обновлений = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/auth/refresh")) {
        обновлений += 1;
        await new Promise((готово) => setTimeout(готово, 5));
        return ответ({ access_token: "свежий" });
      }
      return обновлений === 0 ? отказ("token_expired", 401) : ответ({ ok: true });
    });

    const client = new ApiClient("https://api.test/api/v1", fetchImpl);
    client.setAccessToken("протухший");

    await Promise.all([client.request("/sync"), client.request("/account")]);

    expect(обновлений).toBe(1);
  });

  it("если обновление не прошло — отказ доходит до вызывающего", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith("/auth/refresh")
        ? отказ("bad_credentials", 401)
        : отказ("token_expired", 401),
    );

    const client = new ApiClient("https://api.test/api/v1", fetchImpl);
    client.setAccessToken("протухший");

    await expect(client.request("/sync")).rejects.toBeInstanceOf(ApiError);
    expect(client.authorized).toBe(false);
  });

  it("машинный код и Retry-After доходят до вызывающего", async () => {
    const fetchImpl = vi.fn(async () => отказ("rate_limited", 429, { "Retry-After": "120" }));
    const client = new ApiClient("https://api.test/api/v1", fetchImpl);

    const ошибка = await client
      .request("/sync", { anonymous: true })
      .catch((error: unknown) => error);

    expect(ошибка).toBeInstanceOf(ApiError);
    expect((ошибка as ApiError).code).toBe("rate_limited");
    expect((ошибка as ApiError).retryAfter).toBe(120);
  });

  it("ответ не в problem+json становится внутренней ошибкой, а не падением", async () => {
    // Так отвечает что-то между нами и сервером: nginx, прокси в метро.
    const fetchImpl = vi.fn(
      async () => new Response("<html>502</html>", { status: 502 }),
    );
    const client = new ApiClient("https://api.test/api/v1", fetchImpl);

    const ошибка = await client
      .request("/sync", { anonymous: true })
      .catch((error: unknown) => error);

    expect((ошибка as ApiError).code).toBe("internal_error");
    expect((ошибка as ApiError).status).toBe(502);
  });

  it("нет сети — это не отказ сервера", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const client = new ApiClient("https://api.test/api/v1", fetchImpl);

    await expect(client.request("/sync", { anonymous: true })).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it("204 не разбирается как JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new ApiClient("https://api.test/api/v1", fetchImpl);

    await expect(client.request("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("строка запроса собирается из параметров", async () => {
    const fetchImpl = vi.fn(async () => ответ({}));
    const client = new ApiClient("https://api.test/api/v1", fetchImpl);

    await client.request("/sync", { query: { since: 42, limit: 50 } });

    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://api.test/api/v1/sync?since=42&limit=50");
  });
});
