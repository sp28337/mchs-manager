/** @vitest-environment jsdom */
import "fake-indexeddb/auto";

import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  APPEARANCE_STORAGE_KEY,
  NO_APPEARANCE,
  addConfig,
  isCustomised,
  parseAppearance,
  serializeAppearance,
  type Appearance,
} from "@/components/shared/appearance";
import {
  loadLibrary,
  readEntryProfile,
  removeEntry,
  writeEntry,
  writeIndex,
} from "@/features/shift/storage/library";
import { createProfile, type StoredProfile } from "@/features/shift/storage/profile";

import { ApiClient } from "../api/client";
import { type DataKey } from "../crypto";
// Заведение ключа данных — внутренняя часть крипто-слоя: наружу он
// отдаёт его только через вход и регистрацию, а тесту нужен сам ключ.
import { createDataKey } from "../crypto/dek";
import {
  clearVault,
  forgetVault,
  loadDataKey,
  readMirror,
  readPending,
  saveDataKey,
  writeMeta,
  writeMirror,
  writePending,
  type MirrorRow,
  type PendingRow,
  type SyncMeta,
} from "../store/vault";
import { FakeServer } from "./fake-server";
import { hasUnsentChanges, resolvePending, syncOnce } from "./sync";

// jsdom не приносит WebCrypto, а шифрование здесь настоящее: ставим тот,
// что есть в Node. Подмена именно `crypto`, а не `crypto.subtle`: в jsdom
// это свойство только для чтения.
if (globalThis.crypto?.subtle === undefined) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

/**
 * Синхронизация целиком: два устройства, поддельный сервер по контракту.
 *
 * Главный тест здесь — «правка с одного устройства доезжает до второго».
 * Это готовность шага 11, и проверяется она не моками отдельных вызовов,
 * а настоящим кругом: шифрование, выборка, слияние, отправка, ревизии.
 *
 * Устройство в тестах — это пара хранилищ (`localStorage` и хранилище
 * слоя). Переключение между устройствами — снимок одной пары и
 * восстановление другой: в одном процессе два браузера иначе не свести, а
 * проверять надо именно то, что происходит между ними.
 */

const ПРОФИЛЬ_ID = "6f1e0000-0000-0000-0000-0000000000a1";

function профиль(правки: Partial<StoredProfile> = {}): StoredProfile {
  const основа = createProfile({
    displayName: "Петров И. С.",
    workingConditions: "normal",
    disabilityGroupIorII: false,
    firstShiftDate: "2026-01-02",
    accountingYear: 2026,
    shiftStartTime: "08:00",
    schedulePattern: "1|3",
    customWorkDays: 1,
    customRestDays: 3,
    shiftDurationHours: "24",
  });

  return { ...основа, savedAt: "2026-03-01T10:00:00.000Z", ...правки };
}

/** Снимок устройства: оба хранилища. */
interface Снимок {
  local: Record<string, string>;
  mirror: MirrorRow[];
  pending: PendingRow[];
  meta: SyncMeta | null;
  key: CryptoKey | null;
}

async function снять(): Promise<Снимок> {
  const local: Record<string, string> = {};

  for (let i = 0; i < window.localStorage.length; i += 1) {
    const ключ = window.localStorage.key(i);
    if (ключ !== null) local[ключ] = window.localStorage.getItem(ключ) ?? "";
  }

  const { readMeta } = await import("../store/vault");

  return {
    local,
    mirror: await readMirror(),
    pending: await readPending(),
    meta: await readMeta(),
    key: await loadDataKey(),
  };
}

async function поставить(снимок: Снимок): Promise<void> {
  window.localStorage.clear();
  for (const [ключ, значение] of Object.entries(снимок.local)) {
    window.localStorage.setItem(ключ, значение);
  }

  await clearVault();
  for (const строка of снимок.mirror) await writeMirror(строка);
  for (const строка of снимок.pending) await writePending(строка);
  if (снимок.meta !== null) {
    await writeMeta({
      accountId: снимок.meta.accountId,
      email: снимок.meta.email,
      cursor: снимок.meta.cursor,
      syncedAt: снимок.meta.syncedAt,
    });
  }
  if (снимок.key !== null) await saveDataKey(снимок.key);
}

/** Чистое устройство: ни профилей, ни ревизий. */
async function чистое(): Promise<void> {
  window.localStorage.clear();
  await clearVault();
}

let server: FakeServer;
let client: ApiClient;
let dataKey: DataKey;

beforeEach(async () => {
  forgetVault();
  server = new FakeServer();
  client = new ApiClient("https://api.test/api/v1", server.fetch);
  client.setAccessToken("токен");
  dataKey = await createDataKey();
  await чистое();
  await saveDataKey(dataKey.handle);
});

function синхронизировать() {
  return syncOnce({ client, dataKey });
}

/** Завести на устройстве запись проводника со снимком профиля. */
function завести(profile: StoredProfile, id = ПРОФИЛЬ_ID): void {
  writeIndex({
    folders: [{ id: "grafik13", name: "grafik13", parentId: null }],
    entries: [{ id, folderId: "grafik13", name: profile.displayName, savedAt: profile.savedAt }],
  });
  writeEntry(id, profile);
}

describe("первая синхронизация", () => {
  it("отправляет указатель и профиль, запоминает ревизии", async () => {
    завести(профиль());

    const отчёт = await синхронизировать();

    expect(отчёт.pushed).toBe(2);
    expect(отчёт.received).toBe(0);
    expect(отчёт.rev).toBe(2);
    expect([...server.items.keys()].sort()).toEqual(["6f1e0000-0000-0000-0000-0000000000a1", "index"]);

    // Ревизии запомнены: второй проход без правок не отправляет ничего.
    const второй = await синхронизировать();
    expect(второй.pushed).toBe(0);
  });

  it("пустое устройство ничего не отправляет и не ломается", async () => {
    const отчёт = await синхронизировать();

    expect(отчёт.pushed).toBe(0);
    expect(server.items.size).toBe(0);
  });
});

describe("два устройства", () => {
  it("правка с одного доезжает до второго — готовность шага", async () => {
    // Устройство А: завело профиль и отправило.
    завести(профиль());
    await синхронизировать();
    const А = await снять();

    // Устройство Б: чистое, выбирает всё с нуля.
    await чистое();
    await saveDataKey(dataKey.handle);

    const отчёт = await синхронизировать();

    expect(отчёт.received).toBeGreaterThan(0);
    expect(loadLibrary().entries.map((запись) => запись.id)).toEqual([ПРОФИЛЬ_ID]);
    expect(readEntryProfile(ПРОФИЛЬ_ID)?.displayName).toBe("Петров И. С.");

    // На Б отмечен больничный.
    const наБ = readEntryProfile(ПРОФИЛЬ_ID);
    expect(наБ).not.toBeNull();
    writeEntry(ПРОФИЛЬ_ID, {
      ...(наБ as StoredProfile),
      absences: [
        { id: "a1", kind: "sick_leave", startsOn: "2026-03-03", endsOn: "2026-03-07" },
      ],
      savedAt: "2026-03-02T10:00:00.000Z",
    });
    await синхронизировать();

    // Устройство А возвращается на связь.
    await поставить(А);
    const наА = await синхронизировать();

    expect(наА.received).toBeGreaterThan(0);
    expect(readEntryProfile(ПРОФИЛЬ_ID)?.absences).toHaveLength(1);
    expect(наА.notes).toContainEqual({ kind: "absences", taken: 1 });
  });

  it("на новом устройстве принятый профиль открывается сам", async () => {
    // Иначе человек, вошедший в учётную запись на новом телефоне, видел
    // бы форму «создать профиль» — при том что его график уже приехал и
    // лежит в проводнике. Он бы завёл второй.
    завести(профиль());
    await синхронизировать();

    await чистое();
    await saveDataKey(dataKey.handle);
    await синхронизировать();

    const { activeEntryId } = await import("@/features/shift/storage/library");
    const { loadProfile } = await import("@/features/shift/storage/profile");

    expect(activeEntryId()).toBe(ПРОФИЛЬ_ID);
    const открытый = loadProfile();
    expect(открытый.status).toBe("ok");
    expect(открытый.status === "ok" && открытый.profile.displayName).toBe("Петров И. С.");
  });

  it("открытый профиль синхронизация не подменяет", async () => {
    // Вмешиваться в то, что человек смотрит, она не вправе: чужая
    // запись кладётся в проводник, а на экране остаётся своя.
    завести(профиль());
    await синхронизировать();
    const первое = await снять();

    // Второе устройство заводит свой профиль и отправляет.
    await чистое();
    await saveDataKey(dataKey.handle);
    завести(профиль({ displayName: "Сидоров" }), "6f1e0000-0000-0000-0000-0000000000b2");
    const { activeEntryId: активная } = await import("@/features/shift/storage/library");
    window.localStorage.setItem(
      "shift-schedule.library.active",
      "6f1e0000-0000-0000-0000-0000000000b2",
    );
    await синхронизировать();

    await поставить(первое);
    window.localStorage.setItem("shift-schedule.library.active", ПРОФИЛЬ_ID);
    await синхронизировать();

    expect(активная()).toBe(ПРОФИЛЬ_ID);
    expect(readEntryProfile("6f1e0000-0000-0000-0000-0000000000b2")?.displayName).toBe(
      "Сидоров",
    );
  });

  it("офлайновые правки разных полей сходятся без вопросов", async () => {
    // Случай из раздела 5 контракта: телефон отметил больничный,
    // компьютер поправил время смены, оба были без сети.
    завести(профиль());
    await синхронизировать();
    const компьютер = await снять();

    // Телефон: то же состояние, своя правка.
    const телефон = await снять();
    await поставить(телефон);
    writeEntry(ПРОФИЛЬ_ID, {
      ...профиль(),
      absences: [{ id: "a1", kind: "sick_leave", startsOn: "2026-03-03", endsOn: "2026-03-07" }],
      savedAt: "2026-03-02T09:00:00.000Z",
    });
    await синхронизировать();

    // Компьютер: правка другого поля, базовая ревизия уже устарела.
    await поставить(компьютер);
    writeEntry(ПРОФИЛЬ_ID, {
      ...профиль(),
      shiftStartTime: "09:00",
      savedAt: "2026-03-02T10:00:00.000Z",
    });

    const отчёт = await синхронизировать();

    expect(отчёт.pending).toEqual([]);
    const слитый = readEntryProfile(ПРОФИЛЬ_ID);
    expect(слитый?.shiftStartTime).toBe("09:00");
    expect(слитый?.absences).toHaveLength(1);

    // И то же самое видно на телефоне при следующей выборке.
    await поставить(телефон);
    await синхронизировать();
    const наТелефоне = readEntryProfile(ПРОФИЛЬ_ID);
    expect(наТелефоне?.shiftStartTime).toBe("09:00");
    expect(наТелефоне?.absences).toHaveLength(1);
  });

  it("расхождение настроек не применяется молча, а становится вопросом", async () => {
    завести(профиль());
    await синхронизировать();
    const компьютер = await снять();
    const телефон = await снять();

    // Телефон: другой график.
    await поставить(телефон);
    writeEntry(ПРОФИЛЬ_ID, {
      ...профиль(),
      schedulePattern: "2|2",
      savedAt: "2026-03-02T09:00:00.000Z",
    });
    await синхронизировать();

    // Компьютер: третий график, из той же базовой ревизии.
    await поставить(компьютер);
    writeEntry(ПРОФИЛЬ_ID, {
      ...профиль(),
      schedulePattern: "5|2",
      savedAt: "2026-03-02T10:00:00.000Z",
    });

    const отчёт = await синхронизировать();

    expect(отчёт.pending).toHaveLength(1);
    expect(отчёт.pending[0]?.fields).toEqual(["schedulePattern"]);
    // Своё не переписано: пока человек не ответил, профиль не трогают.
    expect(readEntryProfile(ПРОФИЛЬ_ID)?.schedulePattern).toBe("5|2");
    expect(await readPending()).toHaveLength(1);

    // Человек выбрал «взять оттуда».
    await resolvePending({ client, dataKey, itemId: ПРОФИЛЬ_ID, choice: "remote" });

    expect(readEntryProfile(ПРОФИЛЬ_ID)?.schedulePattern).toBe("2|2");
    expect(await readPending()).toEqual([]);

    // И ответ уехал: телефон увидит его при следующей выборке.
    await поставить(телефон);
    await синхронизировать();
    expect(readEntryProfile(ПРОФИЛЬ_ID)?.schedulePattern).toBe("2|2");
  });

  it("удаление на одном устройстве доезжает до второго", async () => {
    завести(профиль());
    await синхронизировать();
    const второе = await снять();

    // Первое устройство удалило запись.
    writeIndex({ folders: [{ id: "grafik13", name: "grafik13", parentId: null }], entries: [] });
    const { removeEntry } = await import("@/features/shift/storage/library");
    removeEntry(ПРОФИЛЬ_ID);
    await синхронизировать();

    expect(server.items.get(ПРОФИЛЬ_ID)?.deleted).toBe(true);

    // Второе устройство принимает надгробие.
    await поставить(второе);
    const отчёт = await синхронизировать();

    expect(отчёт.deleted).toBe(1);
    expect(readEntryProfile(ПРОФИЛЬ_ID)).toBeNull();
    expect(loadLibrary().entries).toEqual([]);
  });

  it("правка побеждает удаление", async () => {
    // Удалить человек всегда успеет, а воскресить стёртое — нет.
    завести(профиль());
    await синхронизировать();
    const второе = await снять();

    writeIndex({ folders: [{ id: "grafik13", name: "grafik13", parentId: null }], entries: [] });
    const { removeEntry } = await import("@/features/shift/storage/library");
    removeEntry(ПРОФИЛЬ_ID);
    await синхронизировать();

    // На втором устройстве тот же профиль как раз правили.
    await поставить(второе);
    writeEntry(ПРОФИЛЬ_ID, {
      ...профиль(),
      dayNotes: { "2026-03-04": "подменял Петрова" },
      savedAt: "2026-03-03T10:00:00.000Z",
    });

    await синхронизировать();

    expect(readEntryProfile(ПРОФИЛЬ_ID)?.dayNotes).toEqual({ "2026-03-04": "подменял Петрова" });
    expect(server.items.get(ПРОФИЛЬ_ID)?.deleted).toBe(false);
  });
});

describe("углы, в которые легко не заглянуть", () => {
  it("гонка между выборкой и отправкой разрешается слиянием", async () => {
    завести(профиль());
    await синхронизировать();
    const снимок = await снять();

    // Пока мы отправляем свою правку, кто-то успевает записать свою.
    writeEntry(ПРОФИЛЬ_ID, {
      ...профиль(),
      dayNotes: { "2026-03-01": "наше" },
      savedAt: "2026-03-02T10:00:00.000Z",
    });

    let подложено = false;
    server.beforePush = () => {
      if (подложено) return;
      подложено = true;
      const строка = server.items.get(ПРОФИЛЬ_ID);
      if (строка === undefined) return;
      // Подкладываем чужую ревизию: отправка увидит расхождение.
      server.rev += 1;
      server.items.set(ПРОФИЛЬ_ID, { ...строка, rev: server.rev, blob: чужойБлоб });
    };

    // Чужой блоб готовим заранее, тем же ключом и тем же AAD.
    const { encryptJson } = await import("../crypto");
    const чужойБлоб = await encryptJson(
      dataKey,
      { kind: "profile", itemId: ПРОФИЛЬ_ID },
      {
        fmt: 1,
        kind: "profile",
        id: ПРОФИЛЬ_ID,
        updatedAt: "2026-03-02T11:00:00.000Z",
        body: {
          ...профиль(),
          dayNotes: { "2026-03-05": "чужое" },
          savedAt: "2026-03-02T11:00:00.000Z",
        },
      },
    );

    const отчёт = await синхронизировать();

    expect(отчёт.pending).toEqual([]);
    expect(readEntryProfile(ПРОФИЛЬ_ID)?.dayNotes).toEqual({
      "2026-03-01": "наше",
      "2026-03-05": "чужое",
    });
    void снимок;
  });

  it("курсор старше истории — выборка с нуля, и ничего не теряется", async () => {
    завести(профиль());
    await синхронизировать();

    // Сборщик на сервере убрал историю до нашей ревизии.
    server.minRevAvailable = server.rev + 5;
    server.rev += 5;

    const отчёт = await синхронизировать();

    expect(отчёт.resynced).toBe(true);
    expect(readEntryProfile(ПРОФИЛЬ_ID)).not.toBeNull();
  });

  it("нечитаемый блоб не останавливает синхронизацию", async () => {
    завести(профиль());
    await синхронизировать();

    // Чужая запись: блоб, зашифрованный другим ключом.
    const чужой = await createDataKey();
    const { encryptJson } = await import("../crypto");
    const блоб = await encryptJson(
      чужой,
      { kind: "profile", itemId: "чужой-элемент" },
      { fmt: 1, kind: "profile", id: "чужой-элемент", updatedAt: "2026-03-01T10:00:00.000Z", body: профиль() },
    );

    server.rev += 1;
    server.items.set("чужой-элемент", {
      id: "чужой-элемент",
      kind: "profile",
      rev: server.rev,
      deleted: false,
      blob: блоб,
      updated_at: "2026-03-01T10:00:00.000Z",
      size: блоб.length,
      mutations: new Map(),
    });

    const отчёт = await синхронизировать();

    expect(отчёт.skipped).toBe(1);
    // Свой профиль на месте, синхронизация прошла.
    expect(readEntryProfile(ПРОФИЛЬ_ID)).not.toBeNull();
  });

  it("повторная отправка той же правки не создаёт новой ревизии", async () => {
    завести(профиль());
    await синхронизировать();
    const ревизия = server.rev;

    await синхронизировать();

    expect(server.rev).toBe(ревизия);
  });

  it("переименование папки на другом устройстве доезжает", async () => {
    writeIndex({
      folders: [
        { id: "grafik13", name: "grafik13", parentId: null },
        { id: "f1", name: "Караул", parentId: "grafik13" },
      ],
      entries: [],
    });
    await синхронизировать();
    const второе = await снять();

    writeIndex({
      folders: [
        { id: "grafik13", name: "grafik13", parentId: null },
        { id: "f1", name: "4-й караул", parentId: "grafik13" },
      ],
      entries: [],
    });
    await синхронизировать();

    await поставить(второе);
    await синхронизировать();

    expect(loadLibrary().folders.map((папка) => папка.name)).toEqual(["grafik13", "4-й караул"]);
  });

  it("вход на чистом устройстве не поднимает ревизию указателя", async () => {
    // Расхождение только во времени правки — не правка: иначе каждое
    // новое устройство гоняло бы указатель туда-обратно, не изменив в нём
    // ни имени, ни места.
    завести(профиль());
    await синхронизировать();
    const ревизия = server.rev;

    await чистое();
    await saveDataKey(dataKey.handle);
    await синхронизировать();

    expect(server.rev).toBe(ревизия);
    expect(loadLibrary().entries).toHaveLength(1);
  });

  it("ревизии и база живут в хранилище слоя, а не в localStorage", async () => {
    завести(профиль());
    await синхронизировать();

    const строки = await readMirror();

    expect(строки.map((строка) => строка.itemId).sort()).toEqual([ПРОФИЛЬ_ID, "index"]);
    expect(
      Object.keys(window.localStorage).some((ключ) => ключ.includes("mirror")),
    ).toBe(false);
  });
});

describe("есть ли на устройстве непереданное", () => {
  // Нужно там, где отправлять нельзя, а узнать надо: пока не принято обновлённое
  // согласие, проход не идёт, и выход без этого ответа либо пугал бы потерей
  // правок, которых нет, либо молча терял настоящие.

  it("на чистом устройстве — нет", async () => {
    expect(await hasUnsentChanges()).toBe(false);
  });

  it("новый график, не уехавший на сервер, — есть", async () => {
    завести(профиль());

    expect(await hasUnsentChanges()).toBe(true);
  });

  it("после синхронизации — нет, и подсчёт ничего не отправляет и не пишет", async () => {
    завести(профиль());
    await синхронизировать();
    const ревизия = server.rev;
    const зеркало = await readMirror();

    expect(await hasUnsentChanges()).toBe(false);
    expect(server.rev).toBe(ревизия);
    expect(await readMirror()).toEqual(зеркало);
  });

  it("правка уехавшего графика — есть", async () => {
    завести(профиль());
    await синхронизировать();

    writeEntry(ПРОФИЛЬ_ID, { ...профиль(), displayName: "Другое имя", savedAt: "2026-03-02T10:00:00.000Z" });

    expect(await hasUnsentChanges()).toBe(true);
  });

  it("график, стёртый здесь после синхронизации, — есть: надо отправить надгробие", async () => {
    завести(профиль());
    await синхронизировать();

    removeEntry(ПРОФИЛЬ_ID);

    expect(await hasUnsentChanges()).toBe(true);
  });

  it("принятое с другого устройства, когда проход устоялся, — нет", async () => {
    // Первый проход на чистом устройстве принимает чужое, а второй ещё успевает
    // отправить его нормализованным видом (поэтому `сдано` в провайдере делает до
    // трёх проходов). Когда всё устоялось, принятое своей правкой не считается.
    завести(профиль());
    await синхронизировать();

    await чистое();
    await saveDataKey(dataKey.handle);
    await синхронизировать();
    await синхронизировать();

    expect(await hasUnsentChanges()).toBe(false);
  });

  it("неотвеченный вопрос о расхождении — есть", async () => {
    завести(профиль());
    await синхронизировать();
    await writePending({
      itemId: ПРОФИЛЬ_ID,
      rev: 2,
      name: "Петров И. С.",
      fields: ["displayName"],
      remote: { fmt: 1, kind: "profile", id: ПРОФИЛЬ_ID, updatedAt: "2026-03-02T10:00:00.000Z", body: профиль() },
      local: { fmt: 1, kind: "profile", id: ПРОФИЛЬ_ID, updatedAt: "2026-03-02T10:00:00.000Z", body: профиль() },
      at: "2026-03-02T10:00:00.000Z",
    } as PendingRow);

    expect(await hasUnsentChanges()).toBe(true);
  });
});


describe("оформление", () => {
  const T1 = "2026-10-01T10:00:00.000Z";
  const T2 = "2026-10-02T10:00:00.000Z";
  const T3 = "2026-10-03T10:00:00.000Z";

  /** Оформление, выбранное человеком на устройстве: лампа и больничный. */
  function оформление(
    at: string,
    lamp: { id: string; hex: string; createdAt: string }[],
    правки: Partial<Appearance> = {},
  ): Appearance {
    let список = NO_APPEARANCE.lamp as import("@/components/shared/appearance").Palette;
    for (const цвет of lamp) {
      список = addConfig(список, { ...цвет, name: цвет.id });
    }
    return { ...NO_APPEARANCE, at, lamp: { on: true, ...список }, ...правки };
  }

  function положить(значение: Appearance): void {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, serializeAppearance(значение));
  }

  const на_устройстве = () => parseAppearance(window.localStorage.getItem(APPEARANCE_STORAGE_KEY));

  it("нетронутое оформление не отправляется: вход на чистом устройстве не поднимает ревизию", async () => {
    const отчёт = await синхронизировать();

    expect(отчёт.pushed).toBe(0);
    expect(server.items.has("appearance")).toBe(false);
    expect(await hasUnsentChanges()).toBe(false);
  });

  it("выбранное отправляется один раз и приезжает на чистое устройство", async () => {
    положить(оформление(T2, [{ id: "охра", hex: "#ff8800", createdAt: T1 }]));
    expect(await hasUnsentChanges()).toBe(true);

    const первый = await синхронизировать();

    expect(первый.pushed).toBe(1);
    expect(server.items.get("appearance")?.kind).toBe("appearance");
    // Сервер видит непрозрачные байты: ни цвета, ни имени в блобе нет открытым текстом.
    expect(server.items.get("appearance")?.blob).not.toContain("ff8800");
    expect((await синхронизировать()).pushed).toBe(0);
    expect(await hasUnsentChanges()).toBe(false);

    await чистое();
    await saveDataKey(dataKey.handle);
    document.documentElement.removeAttribute("style");

    const отчёт = await синхронизировать();

    expect(отчёт.received).toBeGreaterThan(0);
    const пришло = на_устройстве();
    expect(пришло.lamp.configs.map((цвет) => цвет.name)).toEqual(["охра"]);
    expect(пришло.at).toBe(T2);
    // И сразу на странице, а не только в хранилище.
    expect(document.documentElement.style.getPropertyValue("--lamp-rgb")).toBe("255 136 0");
    expect(await hasUnsentChanges()).toBe(false);
  });

  it("два устройства добавили по цвету офлайн — на обоих оба, в одном порядке, без перебрасывания", async () => {
    положить(оформление(T1, [{ id: "база", hex: "#112233", createdAt: T1 }]));
    await синхронизировать();
    const телефон = await снять();
    const ноутбук = await снять();

    // Телефон добавил «лёд».
    await поставить(телефон);
    положить(
      оформление(T2, [
        { id: "база", hex: "#112233", createdAt: T1 },
        { id: "лёд", hex: "#3366ff", createdAt: T2 },
      ]),
    );
    await синхронизировать();

    // Ноутбук, не зная об этом, добавил «мох».
    await поставить(ноутбук);
    положить(
      оформление(T3, [
        { id: "база", hex: "#112233", createdAt: T1 },
        { id: "мох", hex: "#336633", createdAt: T3 },
      ]),
    );
    const отчёт = await синхронизировать();

    expect(отчёт.pending).toEqual([]);
    const порядок = (значение: Appearance) => значение.lamp.configs.map((цвет) => цвет.id);
    expect(порядок(на_устройстве())).toEqual(["база", "лёд", "мох"]);

    // Телефон возвращается: тот же порядок, и после этого кругу нечего отправлять.
    const после_ноутбука = await снять();
    await поставить(телефон);
    await синхронизировать();
    expect(порядок(на_устройстве())).toEqual(["база", "лёд", "мох"]);
    expect((await синхронизировать()).pushed).toBe(0);

    await поставить(после_ноутбука);
    expect((await синхронизировать()).pushed).toBe(0);
    expect(await hasUnsentChanges()).toBe(false);
  });

  it("сброс до умолчаний на одном устройстве доезжает до другого — правка, а не отсутствие записи", async () => {
    положить(оформление(T1, [{ id: "охра", hex: "#ff8800", createdAt: T1 }]));
    await синхронизировать();
    const второе = await снять();

    // Первое устройство сбросило всё: запись с новым временем и пустыми списками.
    положить({ ...NO_APPEARANCE, at: T2 });
    expect((await синхронизировать()).pushed).toBe(1);

    await поставить(второе);
    await синхронизировать();

    expect(isCustomised(на_устройстве())).toBe(false);
    expect(на_устройстве().at).toBe(T2);
  });

  it("погашенная лампа едет на другие устройства вместе с конфигами", async () => {
    положить(
      оформление(T2, [{ id: "охра", hex: "#ff8800", createdAt: T1 }], {
        lamp: { on: false, configs: [], active: null },
      }),
    );
    await синхронизировать();
    await чистое();
    await saveDataKey(dataKey.handle);

    await синхронизировать();

    expect(на_устройстве().lamp.on).toBe(false);
  });

  it("негодное тело оформления не ломает проход и не стирает своё", async () => {
    положить(оформление(T2, [{ id: "охра", hex: "#ff8800", createdAt: T1 }]));
    await синхронизировать();
    const второе = await снять();

    // Другая версия приложения записала в оформление то, чего мы не знаем:
    // незнакомые ключи и негодный цвет. Читаем годное и ничего не теряем.
    const { encryptJson } = await import("../crypto");
    server.items.get("appearance")!.blob = await encryptJson(
      dataKey,
      { kind: "appearance", itemId: "appearance" },
      {
        fmt: 1,
        kind: "appearance",
        id: "appearance",
        updatedAt: T3,
        body: {
          at: T3,
          будущее: { что: "угодно" },
          lamp: {
            on: true,
            configs: [
              { id: "охра", name: "охра", hex: "#ff8800", createdAt: T1 },
              { id: "x", hex: "не цвет" },
            ],
            active: "x",
          },
          events: { on: true, kinds: { неизвестное: { configs: [], active: null } } },
        },
      },
    );
    server.items.get("appearance")!.rev = (server.rev += 1);

    await поставить(второе);
    const отчёт = await синхронизировать();

    expect(отчёт.skipped).toBe(0);
    // Негодное отброшено по частям (и действующий цвет, чей конфиг негоден, —
    // стандартный), годное осталось.
    expect(на_устройстве().lamp.configs.map((цвет) => цвет.id)).toEqual(["охра"]);
    expect(на_устройстве().lamp.active).toBeNull();
  });
});
