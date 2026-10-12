/**
 * Что лежит на устройстве — в виде конвертов, и обратно.
 *
 * Слой синхронизации не заводит второго хранилища: единица обмена
 * собирается из того же `localStorage`, в котором живёт приложение
 * (`features/shift/storage/`). Иначе появилось бы две правды о профиле —
 * «та, что на экране» и «та, что синхронизируется», — и расходиться они
 * начали бы в первый же день.
 *
 * --- Откуда берётся `updatedAt` --------------------------------------------
 *
 * В локальном формате проводника его нет, а слиянию он нужен (раздел 3
 * контракта). Берётся он так: совпало с базовым состоянием — значит не
 * менялось, время остаётся прежним; не совпало — значит правили, время
 * нынешнее. Поэтому базовое состояние нужно не только слиянию: без него
 * каждая отправка выглядела бы правкой всего сразу.
 */

import {
  activeEntryId,
  loadLibrary,
  openEntry,
  readEntryProfile,
  removeEntry,
  writeEntry,
  writeIndex,
} from "@/features/shift/storage/library";
import {
  hasStoredProfile,
  writeProfileFromSync,
  type StoredProfile,
} from "@/features/shift/storage/profile";

import { deepEqual } from "./deep-equal";
import {
  FMT,
  INDEX_ID,
  type Envelope,
  type IndexBody,
  type IndexEnvelope,
  type ProfileEnvelope,
} from "./envelope";

/** Базовые состояния по опознанию элемента. */
export type Bases = ReadonlyMap<string, Envelope>;

export interface LocalItems {
  index: IndexEnvelope;
  profiles: ProfileEnvelope[];
}

/** Собрать конверты из хранилища устройства. */
export function readLocalItems(bases: Bases, now: string): LocalItems {
  const library = loadLibrary();
  const base = bases.get(INDEX_ID);
  const baseIndex = base?.kind === "index" ? base.body : null;

  const folders = library.folders.map((папка) => {
    const было = baseIndex?.folders.find((строка) => строка.id === папка.id);
    const стало = { ...папка, updatedAt: было?.updatedAt ?? now };

    return было !== undefined && deepEqual(было, стало) ? было : { ...папка, updatedAt: now };
  });

  const entries = library.entries.map((запись) => {
    const было = baseIndex?.entries.find((строка) => строка.id === запись.id);
    const стало = { ...запись, updatedAt: было?.updatedAt ?? now };

    return было !== undefined && deepEqual(было, стало) ? было : { ...запись, updatedAt: now };
  });

  const profiles: ProfileEnvelope[] = [];

  for (const запись of library.entries) {
    const profile = readEntryProfile(запись.id);
    // Строка без снимка — не повод останавливать синхронизацию: снимок
    // мог не записаться (переполненное хранилище), и синхронизировать
    // тогда нечего, а остальные записи поедут как обычно.
    if (profile === null) continue;

    const было = bases.get(запись.id);
    const совпало = было?.kind === "profile" && deepEqual(было.body, profile);

    profiles.push({
      fmt: FMT,
      kind: "profile",
      id: запись.id,
      updatedAt: совпало ? было.updatedAt : now,
      body: profile,
    });
  }

  const индекс: IndexEnvelope = {
    fmt: FMT,
    kind: "index",
    id: INDEX_ID,
    updatedAt: deepEqual(baseIndex, { folders, entries }) ? (base?.updatedAt ?? now) : now,
    body: { folders, entries },
  };

  return { index: индекс, profiles };
}

/** Положить принятый указатель: папки и перечень записей целиком. */
export function applyIndexBody(body: IndexBody): void {
  writeIndex({
    folders: body.folders.map(({ id, name, parentId }) => ({ id, name, parentId })),
    entries: body.entries.map(({ id, folderId, name, savedAt }) => ({
      id,
      folderId,
      name,
      savedAt,
    })),
  });
}

/**
 * Положить принятый (или слитый) профиль в запись.
 *
 * Если эта запись открыта на экране, профиль кладётся и в открытый —
 * иначе человек смотрел бы на вчерашние часы, а его следующая правка
 * легла бы поверх принятого. Время правки при этом не переставляется:
 * им слияние решает, чья правка свежее.
 *
 * --- Первый вход на новом устройстве ---------------------------------------
 *
 * Если открытого профиля нет вовсе, принятый открывается. Без этого
 * человек, вошедший в учётную запись на новом телефоне, видел бы форму
 * «создать профиль» — при том что его график уже приехал и лежит в
 * проводнике. Он бы завёл второй, и дальше у него было бы два.
 *
 * Открывается только когда открывать нечего: вмешиваться в то, что
 * человек смотрит, синхронизация не вправе.
 */
export function applyProfile(itemId: string, profile: StoredProfile): void {
  writeEntry(itemId, profile);

  if (activeEntryId() === itemId) {
    writeProfileFromSync(profile);
    return;
  }

  if (activeEntryId() === null && !hasStoredProfile()) {
    openEntry(itemId);
    writeProfileFromSync(profile);
  }
}

/** Убрать снимок профиля: его удалили на другом устройстве. */
export function removeProfileItem(itemId: string): void {
  removeEntry(itemId);
}
