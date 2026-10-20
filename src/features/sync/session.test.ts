/** @vitest-environment jsdom */
import "fake-indexeddb/auto";

import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { ApiClient } from "./api/client";
import { encryptJson, decryptJson, KDF_V1, parseRecoveryKey } from "./crypto";
import { LEGAL_VERSIONS } from "./legal";
import * as session from "./session";
import {
  clearVault,
  forgetVault,
  loadDataKey,
  readMeta,
  readMirror,
  readPending,
  writeMirror,
  writePending,
} from "./store/vault";

if (globalThis.crypto?.subtle === undefined) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

/**
 * Вход и регистрация: что уходит на сервер и что остаётся на устройстве.
 *
 * Пароль здесь настоящий, шифрование настоящее, а сервер поддельный — и
 * проверяется ровно то, чего не видно по отдельным вызовам: что из пароля
 * выходит одно и то же проверочное значение при регистрации и при входе,
 * что ключ данных переживает перезагрузку страницы, и что выход его
 * уносит.
 *
 * Параметры вывода ключа поддельный сервер отдаёт дешёвые: стойкость
 * проверять нечем — она в числах, а не в коде, — а 64 МиБ argon2id на
 * каждый вход в тесте стоят четверти секунды.
 */
const ДЕШЁВЫЕ = { ...KDF_V1, kdf_version: "kdf_test", memory_kib: 1024, iterations: 1 };

const АДРЕС = "петров@example.com";
/** Обе отметки поставлены: так регистрируется человек, а не тест. */
const ОТМЕЧЕНО = { termsAndPolicy: true, personalData: true };
const ПАРОЛЬ = "мой длинный пароль";

interface Запись {
  verifier: string;
  wrapped_dek_pwd: string;
  wrapped_dek_rec: string;
  consent: Record<string, string>;
  email: string;
}

class ПоддельныйСервер {
  аккаунт: Запись | null = null;
  последнийВход: { email: string; verifier: string } | null = null;
  выходов = 0;
  удалений: { verifier: string }[] = [];
  /** Тело последнего `POST /account/consents`. */
  принятое: Record<string, unknown> | null = null;
  /** Какой идентификатор сервер называет аккаунтом: у двух аккаунтов он разный. */
  идАккаунта = "11111111-1111-1111-1111-111111111111";

  readonly fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const тело: Record<string, string> =
      init?.body === undefined ? {} : JSON.parse(String(init.body));

    if (url.pathname.endsWith("/auth/params")) {
      return json({ ...ДЕШЁВЫЕ });
    }

    if (url.pathname.endsWith("/auth/register")) {
      if (this.аккаунт !== null) return problem(409, "email_taken");

      this.аккаунт = {
        email: тело.email as string,
        verifier: тело.verifier as string,
        wrapped_dek_pwd: тело.wrapped_dek_pwd as string,
        wrapped_dek_rec: тело.wrapped_dek_rec as string,
        consent: (тело as unknown as { consent: Record<string, string> }).consent,
      };

      return json(this.сессия());
    }

    if (url.pathname.endsWith("/auth/login")) {
      this.последнийВход = { email: тело.email as string, verifier: тело.verifier as string };

      if (this.аккаунт === null || this.аккаунт.verifier !== тело.verifier) {
        return problem(401, "bad_credentials");
      }

      return json(this.сессия());
    }

    if (url.pathname.endsWith("/auth/refresh")) {
      if (this.аккаунт === null) return problem(401, "bad_credentials");
      return json(this.сессия());
    }

    if (url.pathname.endsWith("/auth/logout")) {
      this.выходов += 1;
      return new Response(null, { status: 204 });
    }

    if (url.pathname.endsWith("/account/consents") && init?.method === "POST") {
      this.принятое = тело;
      return json({ ...this.сессия().account, usage: { items: 0, bytes: 0 }, consent_pending: [] });
    }

    if (url.pathname.endsWith("/account") && init?.method === "DELETE") {
      this.удалений.push({ verifier: тело.verifier as string });
      this.аккаунт = null;
      return new Response(null, { status: 204 });
    }

    return problem(404, "not_found");
  };

  private сессия() {
    return {
      access_token: "токен-доступа",
      expires_in: 900,
      wrapped_dek_pwd: this.аккаунт?.wrapped_dek_pwd,
      kdf: ДЕШЁВЫЕ,
      account: {
        id: this.идАккаунта,
        email: this.аккаунт?.email ?? АДРЕС,
        email_verified: false,
        created_at: "2026-03-01T10:00:00.000Z",
        rev: 0,
        consents: [],
      },
    };
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function problem(status: number, code: string): Response {
  return new Response(JSON.stringify({ code, status, title: code }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

let server: ПоддельныйСервер;
let client: ApiClient;

beforeEach(async () => {
  forgetVault();
  window.localStorage.clear();
  await clearVault();
  server = new ПоддельныйСервер();
  client = new ApiClient("https://api.test/api/v1", server.fetch);
});

describe("регистрация", () => {
  it("отправляет производные пароля, а не пароль", async () => {
    const итог = await session.register(client, {
      email: ` ${АДРЕС.toUpperCase()} `,
      password: ПАРОЛЬ,
      acts: ОТМЕЧЕНО,
    });

    const запись = server.аккаунт;
    expect(запись).not.toBeNull();
    // Адрес нормализован — иначе человек с заглавной буквы не войдёт.
    expect(запись?.email).toBe(АДРЕС);
    // Пароля нет нигде в отправленном.
    expect(JSON.stringify(запись)).not.toContain(ПАРОЛЬ);
    expect(запись?.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(запись?.wrapped_dek_pwd).toMatch(/^[A-Za-z0-9_-]{80}$/);
    expect(запись?.wrapped_dek_rec).toMatch(/^[A-Za-z0-9_-]{80}$/);

    // Версии документов — те, что в `docs/legal/`.
    expect(запись?.consent).toEqual({
      policy_version: LEGAL_VERSIONS.policy,
      consent_version: LEGAL_VERSIONS.consent,
      terms_version: LEGAL_VERSIONS.terms,
      // Действия названы явно: версии без них — не согласие.
      accepted_terms_and_policy: true,
      accepted_personal_data: true,
    });

    // Ключ восстановления отдан человеку и разбирается обратно.
    expect(parseRecoveryKey(итог.recoveryKeyPrinted)).toBe(итог.recoveryKey);
  });

  it("ключ данных остаётся на устройстве, а сведения об аккаунте — в хранилище слоя", async () => {
    await session.register(client, { email: АДРЕС, password: ПАРОЛЬ, acts: ОТМЕЧЕНО });

    expect(await loadDataKey()).not.toBeNull();
    expect((await readMeta())?.email).toBe(АДРЕС);
    expect((await readMeta())?.cursor).toBe(0);
  });
});

describe("вход", () => {
  it("тот же пароль даёт то же проверочное значение", async () => {
    await session.register(client, { email: АДРЕС, password: ПАРОЛЬ, acts: ОТМЕЧЕНО });
    const зарегистрированный = server.аккаунт?.verifier;

    await session.login(client, { email: АДРЕС, password: ПАРОЛЬ });

    expect(server.последнийВход?.verifier).toBe(зарегистрированный);
    expect(server.последнийВход?.email).toBe(АДРЕС);
  });

  it("другой пароль — отказ, и ключ данных остаётся прежним", async () => {
    const { dataKey } = await session.register(client, { email: АДРЕС, password: ПАРОЛЬ, acts: ОТМЕЧЕНО });
    const ref = { kind: "profile" as const, itemId: "6f1e0000-0000-0000-0000-0000000000a1" };
    const блоб = await encryptJson(dataKey, ref, { fmt: 1, часов: 8 });

    await expect(
      session.login(client, { email: АДРЕС, password: "подобранный пароль" }),
    ).rejects.toThrow();

    // Сравнение по делу, а не по ссылке: хранилище отдаёт дескриптор
    // копией, и «тот же ключ» значит «открывает то же самое».
    const остался = await loadDataKey();
    expect(остался).not.toBeNull();
    expect(
      await decryptJson({ handle: остался as CryptoKey }, ref, блоб),
    ).toEqual({ fmt: 1, часов: 8 });
  });

  it("ключ данных открывает то, что зашифровано им же", async () => {
    const { dataKey } = await session.register(client, { email: АДРЕС, password: ПАРОЛЬ, acts: ОТМЕЧЕНО });
    const ref = { kind: "profile" as const, itemId: "6f1e0000-0000-0000-0000-0000000000a1" };
    const блоб = await encryptJson(dataKey, ref, { fmt: 1, часов: 172.5 });

    const вход = await session.login(client, { email: АДРЕС, password: ПАРОЛЬ });

    expect(await decryptJson(вход.dataKey, ref, блоб)).toEqual({ fmt: 1, часов: 172.5 });
  });
});

describe("чьё это устройство", () => {
  // Гость строит график, не входя, и потом входит. Слой сессии не трогает
  // графики — он отвечает, были ли они этого аккаунта (`continued`), а стирает
  // их провайдер (`sync-provider.tsx`). Здесь проверяется именно ответ и то,
  // что вместе с чужим аккаунтом уходят чужие ревизии.
  const строкаЗеркала = {
    itemId: "6f1e0000-0000-0000-0000-0000000000a1",
    kind: "profile" as const,
    rev: 3,
    base: { fmt: 1 },
  };

  it("регистрация — не продолжение: что лежало на устройстве, к аккаунту не относится", async () => {
    const итог = await session.register(client, { email: АДРЕС, password: ПАРОЛЬ, acts: ОТМЕЧЕНО });

    expect(итог.continued).toBe(false);
  });

  it("вход на устройстве, где аккаунта не было, — не продолжение", async () => {
    await session.register(client, { email: АДРЕС, password: ПАРОЛЬ, acts: ОТМЕЧЕНО });
    await session.logout(client);

    const вход = await session.login(client, { email: АДРЕС, password: ПАРОЛЬ });

    // После выхода устройство ничьё: графики на нём построены гостем.
    expect(вход.continued).toBe(false);
  });

  it("повторный вход тем же аккаунтом продолжает устройство и его ревизии", async () => {
    // Сессия кончилась в фоне, ключ остался: графики на устройстве — его, с
    // правками, которые могли не доехать. Стирать их нельзя.
    await session.register(client, { email: АДРЕС, password: ПАРОЛЬ, acts: ОТМЕЧЕНО });
    await writeMirror(строкаЗеркала);

    const вход = await session.login(client, { email: АДРЕС, password: ПАРОЛЬ });

    expect(вход.continued).toBe(true);
    expect(await readMirror()).toHaveLength(1);
  });

  it("вход другим аккаунтом — не продолжение, и чужие ревизии и вопросы уходят", async () => {
    await session.register(client, { email: АДРЕС, password: ПАРОЛЬ, acts: ОТМЕЧЕНО });
    await writeMirror(строкаЗеркала);
    await writePending({
      itemId: строкаЗеркала.itemId,
      rev: 4,
      name: "Чужой график",
      fields: ["name"],
      remote: {},
      local: {},
      at: "2026-03-01T10:00:00.000Z",
    });
    server.идАккаунта = "22222222-2222-2222-2222-222222222222";

    const вход = await session.login(client, { email: АДРЕС, password: ПАРОЛЬ });

    expect(вход.continued).toBe(false);
    expect(await readMirror()).toEqual([]);
    expect(await readPending()).toEqual([]);
    expect((await readMeta())?.accountId).toBe("22222222-2222-2222-2222-222222222222");
    expect((await readMeta())?.cursor).toBe(0);
  });
});

describe("продолжение сессии", () => {
  it("после перезагрузки страницы данные открываются без пароля", async () => {
    // Access-токен живёт в памяти вкладки и перезагрузку не переживает;
    // cookie и ключ данных — переживают. Иначе человек вводил бы пароль
    // при каждом открытии страницы.
    const { dataKey } = await session.register(client, { email: АДРЕС, password: ПАРОЛЬ, acts: ОТМЕЧЕНО });
    const ref = { kind: "profile" as const, itemId: "6f1e0000-0000-0000-0000-0000000000a1" };
    const блоб = await encryptJson(dataKey, ref, { fmt: 1, часов: 24 });

    const свежий = new ApiClient("https://api.test/api/v1", server.fetch);
    const продолжено = await session.restore(свежий);

    expect(продолжено).not.toBeNull();
    expect(свежий.authorized).toBe(true);
    expect(await decryptJson((продолжено as session.Unlocked).dataKey, ref, блоб)).toEqual({
      fmt: 1,
      часов: 24,
    });
  });

  it("без ключа данных сессия не продолжается", async () => {
    await expect(session.restore(client)).resolves.toBeNull();
  });
});

describe("повторное принятие согласия", () => {
  it("уносит версию согласия и одну отметку, а ответ разбирает", async () => {
    await session.register(client, { email: АДРЕС, password: ПАРОЛЬ, acts: ОТМЕЧЕНО });

    const сведения = await session.acceptConsents(client, true);

    expect(server.принятое).toEqual({
      consent_version: LEGAL_VERSIONS.consent,
      accepted_personal_data: true,
    });
    expect(сведения.consent_pending).toEqual([]);
  });

  it("не подставляет отметку, которой человек не ставил", async () => {
    await session.register(client, { email: АДРЕС, password: ПАРОЛЬ, acts: ОТМЕЧЕНО });

    await session.acceptConsents(client, false);

    expect(server.принятое?.accepted_personal_data).toBe(false);
  });

  it("ответ сервера без списка ожидающих читается как «спрашивать нечего»", async () => {
    // Сервер без повторного принятия поля не присылает: ждать от него вопроса
    // не о чем, и разбор не должен падать.
    const итог = await session.register(client, {
      email: АДРЕС,
      password: ПАРОЛЬ,
      acts: ОТМЕЧЕНО,
    });

    expect(итог.session.account.consent_pending).toEqual([]);
  });
});

describe("выход и удаление", () => {
  it("выход уносит ключ данных с устройства", async () => {
    await session.register(client, { email: АДРЕС, password: ПАРОЛЬ, acts: ОТМЕЧЕНО });

    await session.logout(client);

    expect(server.выходов).toBe(1);
    expect(await loadDataKey()).toBeNull();
    expect(await readMeta()).toBeNull();
  });

  it("выход чистит устройство даже если сервер недоступен", async () => {
    // Иначе ключ данных остался бы лежать после того, как человек нажал
    // «выйти», — и это худшее из двух: сессия на сервере догаснет сама.
    await session.register(client, { email: АДРЕС, password: ПАРОЛЬ, acts: ОТМЕЧЕНО });

    const сломанный = new ApiClient("https://api.test/api/v1", async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(session.logout(сломанный)).rejects.toThrow();
    expect(await loadDataKey()).toBeNull();
  });

  it("удаление спрашивает проверочное значение и чистит устройство", async () => {
    await session.register(client, { email: АДРЕС, password: ПАРОЛЬ, acts: ОТМЕЧЕНО });
    const verifier = server.аккаунт?.verifier;

    await session.deleteAccount(client, { email: АДРЕС, password: ПАРОЛЬ });

    expect(server.удалений).toEqual([{ verifier }]);
    expect(await loadDataKey()).toBeNull();
  });
});
