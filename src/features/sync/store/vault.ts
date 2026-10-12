/**
 * Хранилище слоя синхронизации: IndexedDB, а не `localStorage`.
 *
 * Здесь лежит три вещи, и ни одна из них не укладывается в
 * `localStorage`:
 *
 * * **ключ данных** — дескриптор WebCrypto. `localStorage` хранит строки,
 *   а ключ строкой не выражается вовсе: его байты браузер не отдаёт
 *   (шаг 10). IndexedDB умеет хранить сам объект, и ключ остаётся
 *   неизвлекаемым — пережившим перезагрузку, но по-прежнему нечитаемым.
 * * **базовое состояние** (`base`) — содержимое каждого элемента на
 *   момент подтверждённой сервером ревизии. Нужно трёхсторонней сверке
 *   (раздел 4 контракта): без него любая одновременная правка выглядит
 *   конфликтом, даже когда устройства меняли разные дни. Это третья копия
 *   профиля, и в пяти мегабайтах `localStorage` ей места нет.
 * * **отложенные противоречия** — расхождения настроек, о которых надо
 *   спросить человека. Переживают перезагрузку намеренно: вопрос
 *   «на другом устройстве этот профиль настроен иначе» нельзя терять,
 *   закрыв вкладку.
 *
 * --- Почему ключ данных вообще хранится ------------------------------------
 *
 * Потому что иначе человек вводил бы пароль при каждом открытии
 * страницы: ключ данных выводится из пароля, а пароль мы не храним. При
 * этом хранение ключа здесь не ослабляет ничего: на ЭТОМ устройстве
 * расчёт и профили и так лежат открытым текстом в `localStorage` —
 * сквозное шифрование защищает данные на СЕРВЕРЕ, а не от того, кто
 * сел за разблокированный компьютер. Уходит ключ вместе с выходом из
 * аккаунта (`clearVault`).
 */

const DB_NAME = "grafik13-sync";
const DB_VERSION = 1;

const META = "meta";
const KEYS = "keys";
const MIRROR = "mirror";
const PENDING = "pending";

/** Единственная строка в `meta`. */
export const META_ID = "sync";
/** Единственная строка в `keys`. */
const DEK_ID = "dek";

export interface SyncMeta {
  id: typeof META_ID;
  accountId: string;
  email: string;
  /** Ревизия, до которой выборка доведена. */
  cursor: number;
  /** Когда последняя удачная синхронизация закончилась. */
  syncedAt: string | null;
}

/** Состояние элемента на момент подтверждённой сервером ревизии. */
export interface MirrorRow {
  itemId: string;
  kind: "index" | "profile";
  rev: number;
  /** Конверт элемента (раздел 3 контракта) — как он был на сервере. */
  base: unknown;
}

/** Расхождение настроек, о котором надо спросить человека. */
export interface PendingRow {
  itemId: string;
  /** Ревизия на сервере, с которой пришло расхождение. */
  rev: number;
  /** Имя профиля — чтобы вопрос можно было задать, не расшифровывая снова. */
  name: string;
  /** Поля, в которых стороны разошлись. */
  fields: readonly string[];
  /** Конверт с другого устройства. */
  remote: unknown;
  /** Наш конверт на момент расхождения. */
  local: unknown;
  at: string;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB отказала"));
  });
}

function finish(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB отказала"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB прервала запись"));
  });
}

let открытая: Promise<IDBDatabase> | null = null;

export function openVault(): Promise<IDBDatabase> {
  открытая ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      // Ключи у хранилищ свои (`id`, `itemId`), а не выданные базой:
      // строка про элемент всегда одна, и перезапись должна быть
      // перезаписью, а не вторым рядом.
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(MIRROR)) {
        db.createObjectStore(MIRROR, { keyPath: "itemId" });
      }
      if (!db.objectStoreNames.contains(PENDING)) {
        db.createObjectStore(PENDING, { keyPath: "itemId" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB недоступна"));
  }).catch((error: unknown) => {
    открытая = null;
    throw error;
  });

  return открытая;
}

/** Забыть открытую базу — нужно тестам и выходу из аккаунта. */
export function forgetVault(): void {
  открытая = null;
}

async function read<T>(store: string, key: string): Promise<T | null> {
  const db = await openVault();
  const tx = db.transaction(store, "readonly");
  const value = await request<T | undefined>(tx.objectStore(store).get(key));
  return value ?? null;
}

async function put(store: string, value: unknown): Promise<void> {
  const db = await openVault();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value);
  await finish(tx);
}

async function drop(store: string, key: string): Promise<void> {
  const db = await openVault();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).delete(key);
  await finish(tx);
}

async function all<T>(store: string): Promise<T[]> {
  const db = await openVault();
  const tx = db.transaction(store, "readonly");
  return request<T[]>(tx.objectStore(store).getAll());
}

// --- Ключ данных ------------------------------------------------------------

export async function saveDataKey(key: CryptoKey): Promise<void> {
  await put(KEYS, { id: DEK_ID, key });
}

export async function loadDataKey(): Promise<CryptoKey | null> {
  const row = await read<{ id: string; key: CryptoKey }>(KEYS, DEK_ID);
  return row?.key ?? null;
}

// --- Сведения о сессии ------------------------------------------------------

export async function readMeta(): Promise<SyncMeta | null> {
  return read<SyncMeta>(META, META_ID);
}

export async function writeMeta(meta: Omit<SyncMeta, "id">): Promise<void> {
  await put(META, { ...meta, id: META_ID });
}

// --- Базовое состояние ------------------------------------------------------

export async function readMirror(): Promise<MirrorRow[]> {
  return all<MirrorRow>(MIRROR);
}

export async function writeMirror(row: MirrorRow): Promise<void> {
  await put(MIRROR, row);
}

export async function dropMirror(itemId: string): Promise<void> {
  await drop(MIRROR, itemId);
}

// --- Отложенные противоречия ------------------------------------------------

export async function readPending(): Promise<PendingRow[]> {
  return all<PendingRow>(PENDING);
}

export async function writePending(row: PendingRow): Promise<void> {
  await put(PENDING, row);
}

export async function dropPending(itemId: string): Promise<void> {
  await drop(PENDING, itemId);
}

// --- Выход ------------------------------------------------------------------

/**
 * Забыть всё, что относится к аккаунту.
 *
 * Зовётся при выходе и при удалении аккаунта. Профили и проводник при
 * этом остаются на устройстве: человек вышел из аккаунта, а не стёр свой
 * график — приложение обязано продолжать работать как до входа.
 */
export async function clearVault(): Promise<void> {
  const db = await openVault();
  const tx = db.transaction([META, KEYS, MIRROR, PENDING], "readwrite");

  for (const store of [META, KEYS, MIRROR, PENDING]) {
    tx.objectStore(store).clear();
  }

  await finish(tx);
}
