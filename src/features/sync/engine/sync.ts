/**
 * Один проход синхронизации: выбрать чужое, слить, отправить своё.
 *
 * Порядок именно такой, и он не случаен. Сначала выборка: отправлять,
 * не зная о чужих правках, значит получить расхождение на каждый
 * элемент. Потом слияние — трёхсторонней сверкой (`merge.ts`), с базовым
 * состоянием из хранилища слоя (`store/vault.ts`). И только потом
 * отправка того, что после слияния отличается от подтверждённого
 * сервером.
 *
 * --- Расхождение — не ошибка -----------------------------------------------
 *
 * `POST /sync` отвечает `200` и приносит нынешнее состояние тех
 * элементов, чья базовая ревизия не совпала (раздел 5 контракта). Значит
 * между нашей выборкой и нашей отправкой кто-то успел записать. Такие
 * элементы сливаются ещё раз и отправляются снова — проходов не больше
 * трёх: если и на третьем кто-то успевает, дело не в гонке, а в чём-то
 * ином, и лучше честно сказать «не доехало», чем крутиться вечно.
 *
 * --- Чего здесь нет --------------------------------------------------------
 *
 * Ни одного обращения к React и ни одной строки для человека: этот слой
 * возвращает отчёт значением, а словами его пересказывает экран
 * (`ui/`). Поэтому весь он проверяется тестами без браузера — с поддельным
 * сервером, который ведёт себя по контракту.
 */

import type { ApiClient } from "../api/client";
import { isApiError } from "../api/errors";
import { pullSchema, pushSchema, type PushItem, type RemoteItem } from "../api/schemas";
import { decryptJson, encryptJson, type DataKey } from "../crypto";
import {
  dropMirror,
  dropPending,
  readMeta,
  readMirror,
  readPending,
  writeMeta,
  writeMirror,
  writePending,
  type PendingRow,
} from "../store/vault";
import { deepEqual } from "./deep-equal";
import {
  INDEX_ID,
  parseEnvelopeFor,
  type Envelope,
  type IndexBody,
  type IndexEnvelope,
  type ProfileEnvelope,
} from "./envelope";
import { applyIndexBody, applyProfile, readLocalItems, removeProfileItem } from "./local";
import { mergeIndex, mergeProfile, type MergeNote } from "./merge";

/** Сколько элементов уходит в одной отправке (раздел 7 контракта). */
const BATCH = 50;

/** Сколько раз пробовать отправку, если сервер приносит расхождения. */
const ПРОХОДОВ = 3;

export interface SyncReport {
  /** Ревизия аккаунта на конец прохода. */
  rev: number;
  /** Сколько элементов отправлено. */
  pushed: number;
  /** Сколько принято с других устройств. */
  received: number;
  /** Сколько надгробий принято — то есть удалено здесь. */
  deleted: number;
  /** Что именно принято — для спокойной строки в сводке. */
  notes: MergeNote[];
  /** Элементы, по которым нужен ответ человека. */
  pending: PendingRow[];
  /** Сколько блобов не удалось прочесть: чужая или устаревшая запись. */
  skipped: number;
  /** Пришлось ли выбирать всё с нуля (`resync_required`). */
  resynced: boolean;
}

export interface SyncOptions {
  client: ApiClient;
  dataKey: DataKey;
  now?: () => string;
  newMutationId?: () => string;
}

interface Принятое {
  /** Последнее состояние элемента на сервере. */
  item: RemoteItem;
  /** Расшифрованный конверт или `null` у надгробия и нечитаемого. */
  envelope: Envelope | null;
}

export async function syncOnce(options: SyncOptions): Promise<SyncReport> {
  const now = options.now ?? (() => new Date().toISOString());
  const newMutationId = options.newMutationId ?? (() => crypto.randomUUID());

  const meta = await readMeta();
  const отчёт: SyncReport = {
    rev: meta?.cursor ?? 0,
    pushed: 0,
    received: 0,
    deleted: 0,
    notes: [],
    pending: [],
    skipped: 0,
    resynced: false,
  };

  const выборка = await выбрать(options, meta?.cursor ?? 0, отчёт);
  отчёт.rev = выборка.rev;

  // Базовые состояния — после выборки: она их не меняет, зато ей могли
  // прийти элементы, которых у нас ещё нет.
  const bases = new Map<string, Envelope>();
  const revs = new Map<string, number>();

  for (const строка of await readMirror()) {
    const конверт = parseEnvelopeFor(строка.base, строка.kind, строка.itemId);
    if (конверт !== null) bases.set(строка.itemId, конверт);
    revs.set(строка.itemId, строка.rev);
  }

  // Вопросы, на которые человек ещё не ответил: такие элементы не
  // трогаются вовсе — ни применением, ни отправкой.
  const отложенные = new Set((await readPending()).map((строка) => строка.itemId));

  const локальные = readLocalItems(bases, now());
  const отправить: { item: PushItem; envelope: Envelope }[] = [];

  // --- Указатель ------------------------------------------------------------

  const принятыйИндекс = выборка.принятое.get(INDEX_ID);
  const индекс = слитьИндекс(локальные.index, принятыйИндекс, bases.get(INDEX_ID) ?? null);

  отчёт.notes.push(...индекс.notes);
  if (индекс.принято) отчёт.received += 1;

  // --- Профили --------------------------------------------------------------

  const свои = new Map(локальные.profiles.map((конверт) => [конверт.id, конверт]));
  const ids = new Set<string>([
    ...свои.keys(),
    ...revs.keys(),
    ...выборка.принятое.keys(),
  ]);
  ids.delete(INDEX_ID);

  const слитые = new Map<string, ProfileEnvelope>();

  for (const id of ids) {
    if (отложенные.has(id)) continue;

    const наш = свои.get(id) ?? null;
    const принято = выборка.принятое.get(id);
    const было = bases.get(id);
    const base = было?.kind === "profile" ? было.body : null;
    const rev = revs.get(id) ?? 0;

    const чужой =
      принято?.envelope?.kind === "profile" ? принято.envelope : null;
    const надгробие = принято?.item.deleted === true;

    // 1. Надгробие с сервера.
    if (надгробие) {
      if (наш === null) {
        await dropMirror(id);
        continue;
      }

      // Правка побеждает удаление: удалить человек всегда успеет, а
      // воскресить стёртое — нет (раздел 5 контракта).
      if (base !== null && deepEqual(base, наш.body)) {
        removeProfileItem(id);
        await dropMirror(id);
        отчёт.deleted += 1;
      } else {
        отправить.push({ item: правка(id, наш, принято.item.rev, newMutationId()), envelope: наш });
      }
      continue;
    }

    // 2. Элемент удалён здесь, на сервере жив и не менялся.
    if (наш === null) {
      if (чужой !== null && принято !== undefined) {
        // Пришёл с другого устройства — заводим у себя.
        применить(id, чужой);
        слитые.set(id, чужой);
        await writeMirror({ itemId: id, kind: "profile", rev: принято.item.rev, base: чужой });
        отчёт.received += 1;
        continue;
      }

      if (rev > 0) {
        // Был подтверждён сервером и пропал у нас: человек его удалил.
        отправить.push({ item: надгробиеДля(id, rev, newMutationId()), envelope: пустой(id) });
      }
      continue;
    }

    // 3. Элемент есть у нас и пришёл с сервера — слияние.
    if (чужой !== null && принято !== undefined) {
      const слияние = mergeProfile(base, наш.body, чужой.body);

      if (слияние.conflicts.length > 0) {
        // Решать человеку. До ответа элемент не трогается ни здесь, ни на
        // сервере: иначе ответ «оставить своё» пришёл бы к уже
        // переписанному профилю.
        const строка: PendingRow = {
          itemId: id,
          rev: принято.item.rev,
          name: наш.body.displayName,
          fields: слияние.conflicts.map((спор) => спор.field),
          remote: чужой,
          local: наш,
          at: now(),
        };
        await writePending(строка);
        отчёт.pending.push(строка);
        continue;
      }

      отчёт.notes.push(...слияние.notes);

      const слитый: ProfileEnvelope = {
        ...наш,
        updatedAt: now(),
        body: слияние.merged,
      };

      if (!deepEqual(слияние.merged, наш.body)) {
        применить(id, слитый);
        отчёт.received += 1;
      }

      слитые.set(id, слитый);

      if (!deepEqual(слияние.merged, чужой.body)) {
        отправить.push({
          item: правка(id, слитый, принято.item.rev, newMutationId()),
          envelope: слитый,
        });
      } else {
        await writeMirror({ itemId: id, kind: "profile", rev: принято.item.rev, base: слитый });
      }
      continue;
    }

    // 4. Только у нас: новый или правленый с прошлой синхронизации.
    if (base === null || !deepEqual(base, наш.body)) {
      отправить.push({ item: правка(id, наш, rev, newMutationId()), envelope: наш });
    }
  }

  // Указатель отправляется последним из списка, но собирается первым:
  // порядок в отправке неважен, сервер применяет элементы независимо.
  if (индекс.отправить !== null) {
    отправить.push({
      item: правка(INDEX_ID, индекс.отправить, revs.get(INDEX_ID) ?? 0, newMutationId()),
      envelope: индекс.отправить,
    });
  }

  // --- Отправка -------------------------------------------------------------

  if (отправить.length > 0) {
    const итог = await отправить_всё(options, отправить, отчёт, now);
    отчёт.rev = Math.max(отчёт.rev, итог);
  }

  await writeMeta({
    accountId: meta?.accountId ?? "",
    email: meta?.email ?? "",
    cursor: отчёт.rev,
    syncedAt: now(),
  });

  return отчёт;

  // --- Внутреннее -----------------------------------------------------------

  function применить(id: string, конверт: ProfileEnvelope): void {
    applyProfile(id, конверт.body);
    слитые.set(id, конверт);
  }

  function слитьИндекс(
    наш: IndexEnvelope,
    принято: Принятое | undefined,
    было: Envelope | null,
  ): { notes: MergeNote[]; принято: boolean; отправить: IndexEnvelope | null } {
    const base = было?.kind === "index" ? было.body : null;
    const чужой = принято?.envelope?.kind === "index" ? принято.envelope : null;

    if (чужой === null) {
      // Пустой указатель отправлять незачем: папку grafik13 заводит само
      // приложение при первом чтении (`loadLibrary`), и без неё
      // указателя не бывает вовсе. Отправь мы его — и вход на чистом
      // устройстве поднимал бы ревизию аккаунта, не сказав ничего: ни
      // одной записи в нём нет.
      if (base === null && пустойУказатель(наш.body)) {
        return { notes: [], принято: false, отправить: null };
      }

      const менялся = base === null || !deepEqual(base, наш.body);
      return { notes: [], принято: false, отправить: менялся ? наш : null };
    }

    const { merged, notes } = mergeIndex(base, наш.body, чужой.body);
    const слитый: IndexEnvelope = { ...наш, updatedAt: now(), body: merged };
    const изменилось = !deepEqual(merged, наш.body);

    if (изменилось) applyIndexBody(merged);

    return {
      notes,
      принято: изменилось,
      отправить: deepEqual(merged, чужой.body) ? null : слитый,
    };
  }
}

/**
 * Есть ли на устройстве то, что ещё не уехало на сервер.
 *
 * Тот же вопрос, на который отвечает проход («только у нас: новый или правленый с
 * прошлой синхронизации», пункт 4 в `syncOnce`), но без сети и без записи: нужен
 * там, где отправлять нельзя, а узнать надо — пока человек не принял обновлённое
 * согласие (`consent-renewal.tsx`), проход не идёт, и выход не может «сдать» правки
 * сервером. Чужие правки на сервере не смотрятся: вопрос про устройство.
 *
 * Условия те же, что в проходе: новый или изменённый профиль, изменённый указатель,
 * подтверждённый сервером и стёртый здесь элемент (надо отправить надгробие), а
 * также любой неотвеченный вопрос о расхождении.
 */
export async function hasUnsentChanges(
  now: () => string = () => new Date().toISOString(),
): Promise<boolean> {
  if ((await readPending()).length > 0) return true;

  const bases = new Map<string, Envelope>();
  const revs = new Map<string, number>();

  for (const строка of await readMirror()) {
    const конверт = parseEnvelopeFor(строка.base, строка.kind, строка.itemId);
    if (конверт !== null) bases.set(строка.itemId, конверт);
    revs.set(строка.itemId, строка.rev);
  }

  const локальные = readLocalItems(bases, now());

  const было = bases.get(INDEX_ID);
  const base = было?.kind === "index" ? было.body : null;
  const индексМенялся =
    base === null ? !пустойУказатель(локальные.index.body) : !deepEqual(base, локальные.index.body);
  if (индексМенялся) return true;

  const свои = new Set<string>();

  for (const профиль of локальные.profiles) {
    свои.add(профиль.id);
    const основа = bases.get(профиль.id);
    if (основа?.kind !== "profile" || !deepEqual(основа.body, профиль.body)) return true;
  }

  for (const [id, rev] of revs) {
    if (id !== INDEX_ID && rev > 0 && !свои.has(id)) return true;
  }

  return false;
}

/** Указатель, в котором нечего синхронизировать: одна папка grafik13. */
function пустойУказатель(body: IndexBody): boolean {
  return (
    body.entries.length === 0 &&
    body.folders.length === 1 &&
    body.folders[0]?.id === "grafik13"
  );
}

function правка(
  id: string,
  конверт: Envelope,
  base_rev: number,
  mutation_id: string,
): PushItem {
  return {
    id,
    kind: конверт.kind,
    base_rev,
    mutation_id,
    deleted: false,
  };
}

function надгробиеДля(id: string, base_rev: number, mutation_id: string): PushItem {
  return { id, kind: "profile", base_rev, mutation_id, deleted: true };
}

/** Пустой конверт: нужен только затем, чтобы у надгробия был вид элемента. */
function пустой(id: string): Envelope {
  return { fmt: 1, kind: "profile", id, updatedAt: "", body: null as never };
}

async function выбрать(
  options: SyncOptions,
  курсор: number,
  отчёт: SyncReport,
): Promise<{ rev: number; принятое: Map<string, Принятое> }> {
  const принятое = new Map<string, Принятое>();
  let since = курсор;
  let rev = курсор;

  for (;;) {
    let страница;

    try {
      страница = pullSchema.parse(
        await options.client.request("/sync", { query: { since, limit: BATCH } }),
      );
    } catch (error) {
      // Курсор старше полной истории: надгробий за этот срок уже нет, и
      // узнать об удалениях иначе нельзя — выбираем всё с нуля.
      if (isApiError(error, "resync_required") && since > 0) {
        отчёт.resynced = true;
        since = 0;
        continue;
      }
      throw error;
    }

    rev = Math.max(rev, страница.rev);

    for (const item of страница.items) {
      принятое.set(item.id, {
        item,
        envelope: item.deleted
          ? null
          : await прочесть(options, item, отчёт),
      });
      since = Math.max(since, item.rev);
    }

    if (!страница.has_more) return { rev, принятое };
  }
}

async function прочесть(
  options: SyncOptions,
  item: RemoteItem,
  отчёт: SyncReport,
): Promise<Envelope | null> {
  if (typeof item.blob !== "string") return null;

  try {
    const открытое = await decryptJson(
      options.dataKey,
      { kind: item.kind, itemId: item.id },
      item.blob,
    );
    const конверт = parseEnvelopeFor(открытое, item.kind, item.id);

    if (конверт === null) отчёт.skipped += 1;
    return конверт;
  } catch {
    // Не расшифровалось или не разобралось: чужой ключ, запись другой
    // версии приложения, поврежденные байты. Остальные элементы это не
    // останавливает, а молча терять такое нельзя — счётчик уйдёт в сводку.
    отчёт.skipped += 1;
    return null;
  }
}

async function отправить_всё(
  options: SyncOptions,
  список: { item: PushItem; envelope: Envelope }[],
  отчёт: SyncReport,
  now: () => string,
): Promise<number> {
  let очередь = список;
  let rev = отчёт.rev;

  for (let проход = 0; проход < ПРОХОДОВ && очередь.length > 0; проход += 1) {
    const снова: typeof очередь = [];

    for (let i = 0; i < очередь.length; i += BATCH) {
      const кусок = очередь.slice(i, i + BATCH);
      const items: PushItem[] = [];

      for (const { item, envelope } of кусок) {
        items.push(
          item.deleted
            ? item
            : {
                ...item,
                blob: await encryptJson(
                  options.dataKey,
                  { kind: item.kind, itemId: item.id },
                  envelope,
                ),
              },
        );
      }

      const ответ = pushSchema.parse(
        await options.client.request("/sync", { method: "POST", body: { items } }),
      );

      rev = Math.max(rev, ответ.rev);

      for (const принято of ответ.applied) {
        const свой = кусок.find(({ item }) => item.id === принято.id);
        if (свой === undefined) continue;

        отчёт.pushed += 1;

        if (свой.item.deleted) {
          await dropMirror(принято.id);
        } else {
          await writeMirror({
            itemId: принято.id,
            kind: принято.kind,
            rev: принято.rev,
            base: свой.envelope,
          });
        }
      }

      // Расхождение: между выборкой и отправкой кто-то записал. Сливаем с
      // принесённым состоянием и пробуем ещё раз.
      for (const чужое of ответ.conflicts) {
        const свой = кусок.find(({ item }) => item.id === чужое.id);
        if (свой === undefined) continue;

        const пересобранное = await пересобрать(options, свой, чужое, отчёт, now);
        if (пересобранное !== null) снова.push(пересобранное);
      }
    }

    очередь = снова;
  }

  return rev;
}

async function пересобрать(
  options: SyncOptions,
  свой: { item: PushItem; envelope: Envelope },
  чужое: RemoteItem,
  отчёт: SyncReport,
  now: () => string,
): Promise<{ item: PushItem; envelope: Envelope } | null> {
  const конверт = чужое.deleted ? null : await прочесть(options, чужое, отчёт);

  // Надгробие в расхождении: элемент удалён, пока мы отправляли правку.
  // Правка побеждает — отправляем её же, но от нынешней ревизии.
  if (конверт === null) {
    return {
      item: { ...свой.item, base_rev: чужое.rev, mutation_id: crypto.randomUUID() },
      envelope: свой.envelope,
    };
  }

  if (конверт.kind === "index" && свой.envelope.kind === "index") {
    const { merged, notes } = mergeIndex(null, свой.envelope.body, конверт.body);
    отчёт.notes.push(...notes);
    applyIndexBody(merged);

    const слитый: IndexEnvelope = { ...свой.envelope, updatedAt: now(), body: merged };
    return {
      item: { ...свой.item, base_rev: чужое.rev, mutation_id: crypto.randomUUID() },
      envelope: слитый,
    };
  }

  if (конверт.kind === "profile" && свой.envelope.kind === "profile") {
    const слияние = mergeProfile(null, свой.envelope.body, конверт.body);

    if (слияние.conflicts.length > 0) {
      const строка: PendingRow = {
        itemId: свой.item.id,
        rev: чужое.rev,
        name: свой.envelope.body.displayName,
        fields: слияние.conflicts.map((спор) => спор.field),
        remote: конверт,
        local: свой.envelope,
        at: now(),
      };
      await writePending(строка);
      отчёт.pending.push(строка);
      return null;
    }

    отчёт.notes.push(...слияние.notes);
    applyProfile(свой.item.id, слияние.merged);

    const слитый: ProfileEnvelope = {
      ...свой.envelope,
      updatedAt: now(),
      body: слияние.merged,
    };
    return {
      item: { ...свой.item, base_rev: чужое.rev, mutation_id: crypto.randomUUID() },
      envelope: слитый,
    };
  }

  return null;
}

/**
 * Ответ человека на расхождение настроек.
 *
 * Три выхода из раздела 5 контракта: оставить своё, взять оттуда,
 * сохранить обе копии. Первые два — это слияние с заданной стороной;
 * третий заводит рядом вторую запись, и его делает экран (ему же
 * придумывать ей имя), а сюда приходит уже готовым решением.
 */
export async function resolvePending(
  options: SyncOptions & { itemId: string; choice: "local" | "remote" },
): Promise<void> {
  const строка = (await readPending()).find((готовая) => готовая.itemId === options.itemId);
  if (строка === undefined) return;

  const наш = parseEnvelopeFor(строка.local, "profile", строка.itemId);
  const чужой = parseEnvelopeFor(строка.remote, "profile", строка.itemId);

  if (наш?.kind !== "profile" || чужой?.kind !== "profile") {
    await dropPending(options.itemId);
    return;
  }

  const { merged } = mergeProfile(null, наш.body, чужой.body, { prefer: options.choice });

  applyProfile(options.itemId, merged);
  await dropPending(options.itemId);

  // Базовым состоянием становится то, что принесла другая сторона: наш
  // ответ ляжет поверх её ревизии, а не будет спорить с ней заново.
  // Следующий проход увидит, что слитое отличается от базового, и
  // отправит его.
  await writeMirror({
    itemId: options.itemId,
    kind: "profile",
    rev: строка.rev,
    base: чужой,
  });

  await syncOnce(options).catch(() => {
    // Нет сети — не беда: ответ уже записан на устройстве и уедет
    // следующим проходом.
  });
}
