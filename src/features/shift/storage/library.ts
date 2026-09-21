/**
 * Проводник по профилям: несколько графиков на одном устройстве.
 *
 * --- Что это и чем оно НЕ является ----------------------------------------
 *
 * Профиль у приложения по-прежнему ОДИН — тот, что открыт: он лежит там же,
 * где лежал всегда (`profile.ts`, ключ `shift-schedule.profile`), читается
 * и пишется теми же тремя функциями, и формат его не изменился ни на поле.
 * Всё, что здесь заведено, — надстройка СВЕРХУ: список сохранённых графиков
 * с папками, из которого открытый можно сменить.
 *
 * Это не случайность, а условие. У человека в браузере лежит год внесённых
 * отпусков, и трогать ради новой возможности ту единственную запись, в
 * которой он живёт, нельзя. Поэтому старое хранилище осталось нетронутым:
 * не заработай эта надстройка вовсе — человек не заметит ничего, кроме
 * пустого проводника.
 *
 * --- Откуда в проводнике берётся профиль, заведённый ДО него ---------------
 *
 * Сам собой, без переноса и без единого действия человека. Открытый профиль
 * ОТРАЖАЕТСЯ сюда при каждой записи (`syncActiveIntoLibrary`, зовётся из
 * `use-profile.ts` — там же, где идёт запись в хранилище). Отражать нечего
 * только в одном случае: если запись, на которую указывает `ACTIVE_KEY`, не
 * найдена, — тогда она заводится. У того, кто обновил приложение со старой
 * версии, указателя нет вовсе, и его график появляется в папке grafik13 при
 * первом же открытии страницы.
 *
 * --- Почему снимок, а не ссылка --------------------------------------------
 *
 * Запись проводника хранит профиль ЦЕЛИКОМ, отдельным ключом. Держать
 * вместо этого ссылку на открытый профиль было бы дешевле, но тогда
 * «сохранённых графиков» в проводнике было бы ровно один — открытый, — а
 * смысл затеи в обратном.
 *
 * --- Почему указатель, а не поле в профиле ---------------------------------
 *
 * Какой записи проводника отвечает открытый профиль, помнит отдельный ключ
 * (`ACTIVE_KEY`). Попади этот признак в сам профиль — он попал бы и в файл,
 * и профиль, открытый на другом устройстве, принёс бы туда указатель на
 * чужую запись, которой там нет. Формат файла к тому же обязан остаться
 * прежним: файлы, сохранённые старой версией, открываются новой, и наоборот.
 */

import { z } from "zod";

import { storedProfileSchema, type StoredProfile } from "./profile";

/** Перечень папок и записей. Сами профили лежат каждый своим ключом. */
const INDEX_KEY = "shift-schedule.library";

/** Начало ключа, под которым лежит снимок профиля одной записи. */
const ENTRY_PREFIX = "shift-schedule.library.entry.";

/** Какой записи проводника отвечает открытый сейчас профиль. */
const ACTIVE_KEY = "shift-schedule.library.active";

/**
 * Папка, в которой профили оказываются изначально.
 *
 * Опознание у неё постоянное, а не выданное при создании: её заводит не
 * человек, а само приложение — и заводит заново каждый раз, когда её не
 * находит (`loadLibrary`). Совпадение опознания с именем здесь случайно и
 * ни на что не влияет: имя человек вправе сменить, опознание — нет.
 */
export const ROOT_FOLDER_ID = "grafik13";
export const ROOT_FOLDER_NAME = "grafik13";

export const MAX_FOLDER_NAME_LENGTH = 60;

export interface LibraryFolder {
  id: string;
  name: string;
  /**
   * Папка, в которой лежит эта, или `null` у самой grafik13.
   *
   * Появилось позже остального, и потому необязательное: у папок,
   * заведённых до вложенности, поля нет вовсе — они лежали прямо в
   * grafik13, туда же их и относит умолчание.
   */
  parentId: string | null;
}

export interface LibraryEntry {
  id: string;
  folderId: string;
  /** Имя профиля на момент последней записи — чтобы не читать снимок ради строки. */
  name: string;
  savedAt: string;
}

export interface Library {
  folders: LibraryFolder[];
  entries: LibraryEntry[];
}

const folderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(MAX_FOLDER_NAME_LENGTH),
  parentId: z.string().min(1).nullable().default(ROOT_FOLDER_ID),
});

const entrySchema = z.object({
  id: z.string().min(1),
  folderId: z.string().min(1),
  name: z.string().max(200),
  savedAt: z.string(),
});

const librarySchema = z.object({
  folders: z.array(folderSchema).max(100).default([]),
  entries: z.array(entrySchema).max(200).default([]),
});

/**
 * Имя события «проводник изменился».
 *
 * По той же причине, что и у профиля (`profile.ts`): родное `storage`
 * браузер шлёт только ДРУГИМ вкладкам, а проводник обязан обновиться и в
 * той, где нажали, — иначе переименованная папка осталась бы со старым
 * именем до перезагрузки страницы.
 */
const LIBRARY_EVENT = "shift-schedule.library";

function announce(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LIBRARY_EVENT));
}

export function subscribeToLibrary(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(LIBRARY_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(LIBRARY_EVENT, onChange);
  };
}

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Хранилище может быть недоступно: приватное окно, запрет данных сайту.
    return null;
  }
}

/**
 * Запись, которой позволено не удаться.
 *
 * Проводник — надстройка над профилем, а не он сам: человек в этот миг
 * правит свой график, и тот уже сохранён (`saveProfile` сработал раньше и
 * своё исключение бросил бы сам). Ронять страницу из-за того, что не
 * обновился СПИСОК графиков, нельзя — худшее следствие здесь в том, что в
 * проводнике останется вчерашняя отметка времени.
 */
function write(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function remove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Нечего чистить — и нечего сообщать.
  }
}

function newId(): string {
  // `randomUUID` есть во всех браузерах, которые понимает это приложение,
  // но существует он только в защищённом окружении (https или localhost).
  // Запасной путь нужен ровно для этого случая: опознание здесь не тайна,
  // ему довольно быть непохожим на соседнее.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Перечень папок и записей — всегда пригодный к работе.
 *
 * Испорченный перечень не роняет проводник и не стирается: он заменяется
 * пустым, а снимки профилей остаются лежать своими ключами. Папка grafik13
 * дописывается, если её нет: она не создаётся человеком и потому не может
 * отсутствовать.
 */
export function loadLibrary(): Library {
  const raw = read(INDEX_KEY);
  let library: Library = { folders: [], entries: [] };

  if (raw !== null) {
    try {
      const parsed = librarySchema.safeParse(JSON.parse(raw));
      if (parsed.success) library = parsed.data;
    } catch {
      // Битый JSON — то же, что пустой перечень.
    }
  }

  const listed = library.folders.some((folder) => folder.id === ROOT_FOLDER_ID)
    ? library.folders
    : [{ id: ROOT_FOLDER_ID, name: ROOT_FOLDER_NAME, parentId: null }, ...library.folders];

  // У grafik13 родителя нет по определению: она и есть верх. Папка, чей
  // родитель исчез, поднимается в неё — вместе со всем, что внутри.
  const ids = new Set(listed.map((folder) => folder.id));
  const folders = listed.map((folder) =>
    folder.id === ROOT_FOLDER_ID
      ? { ...folder, parentId: null }
      : folder.parentId !== null && ids.has(folder.parentId)
        ? folder
        : { ...folder, parentId: ROOT_FOLDER_ID },
  );

  // Запись, чья папка исчезла, возвращается в grafik13, а не пропадает с
  // глаз: в ней лежит чей-то год работы.
  const known = ids;
  const entries = library.entries.map((entry) =>
    known.has(entry.folderId) ? entry : { ...entry, folderId: ROOT_FOLDER_ID },
  );

  return { folders, entries };
}

function writeLibrary(library: Library): void {
  write(INDEX_KEY, JSON.stringify(library));
  announce();
}

/** Снимок профиля одной записи или `null`, если он не читается. */
export function readEntryProfile(id: string): StoredProfile | null {
  const raw = read(`${ENTRY_PREFIX}${id}`);
  if (raw === null) return null;
  try {
    const parsed = storedProfileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeEntryProfile(id: string, profile: StoredProfile): boolean {
  return write(`${ENTRY_PREFIX}${id}`, JSON.stringify(profile));
}

export function activeEntryId(): string | null {
  return read(ACTIVE_KEY);
}

function writeActiveId(id: string): void {
  write(ACTIVE_KEY, id);
}

/**
 * Отражение открытого профиля в его запись.
 *
 * Зовётся при КАЖДОЙ записи профиля (`use-profile.ts`), потому что
 * отдельного «сохранить в проводник» у приложения нет и быть не должно:
 * правка уже сохранена в тот же миг, когда сделана, и список графиков,
 * показывающий вчерашнее состояние открытого графика, врал бы.
 *
 * Записи нет — она заводится здесь. Это единственный путь, которым профиль
 * попадает в проводник сам: так сюда приходит и график, заведённый до
 * появления проводника, и только что созданный, и открытый из файла.
 */
export function syncActiveIntoLibrary(profile: StoredProfile): void {
  const library = loadLibrary();
  const id = activeEntryId();
  const existing = id === null ? undefined : library.entries.find((entry) => entry.id === id);

  if (existing === undefined) {
    const entry: LibraryEntry = {
      id: newId(),
      folderId: ROOT_FOLDER_ID,
      name: profile.displayName,
      savedAt: profile.savedAt,
    };
    // Указатель ставится только после удачной записи снимка: иначе
    // проводник показал бы строку, за которой ничего нет, а следующая
    // правка ушла бы в ту же пустоту.
    if (!writeEntryProfile(entry.id, profile)) return;
    writeActiveId(entry.id);
    writeLibrary({ ...library, entries: [...library.entries, entry] });
    return;
  }

  if (!writeEntryProfile(existing.id, profile)) return;
  writeLibrary({
    ...library,
    entries: library.entries.map((entry) =>
      entry.id === existing.id
        ? { ...entry, name: profile.displayName, savedAt: profile.savedAt }
        : entry,
    ),
  });
}

/**
 * Открыть запись: её снимок становится тем, что покажет страница.
 *
 * Указатель переставляется ЗДЕСЬ, до того как профиль уйдёт на экран.
 * Иначе первая же правка открытого графика ушла бы в запись прежнего — и
 * переписала бы чужой профиль своим.
 */
export function openEntry(id: string): StoredProfile | null {
  const profile = readEntryProfile(id);
  if (profile === null) return null;
  writeActiveId(id);
  return profile;
}

/**
 * Забыть, какой записи отвечает открытый профиль.
 *
 * Нужно там, где на экран встаёт профиль, которого в проводнике ещё нет:
 * только что созданный. Без этого его первая запись легла бы поверх
 * снимка того графика, что был открыт до него.
 */
export function detachActive(): void {
  remove(ACTIVE_KEY);
}

/**
 * Удалить профиль с устройства целиком — вместе с его записью в проводнике.
 *
 * Зовётся удалением профиля из настроек. Оставить снимок в проводнике
 * значило бы ответить «удалено» и сохранить копию: ровно то, чего человек
 * этой кнопкой и избегает.
 */
export function forgetActive(): void {
  const id = activeEntryId();
  remove(ACTIVE_KEY);
  if (id === null) return;
  deleteEntry(id);
}

/** Профиль из файла — новой записью, не трогая открытый. */
export function importEntry(profile: StoredProfile, folderId = ROOT_FOLDER_ID): LibraryEntry {
  const library = loadLibrary();
  const entry: LibraryEntry = {
    id: newId(),
    folderId: library.folders.some((folder) => folder.id === folderId)
      ? folderId
      : ROOT_FOLDER_ID,
    name: profile.displayName,
    savedAt: profile.savedAt,
  };
  writeEntryProfile(entry.id, profile);
  writeLibrary({ ...library, entries: [...library.entries, entry] });
  return entry;
}

export function createFolder(name: string, parentId = ROOT_FOLDER_ID): LibraryFolder {
  const library = loadLibrary();
  const folder: LibraryFolder = {
    id: newId(),
    name: folderName(name),
    parentId: library.folders.some((known) => known.id === parentId)
      ? parentId
      : ROOT_FOLDER_ID,
  };
  writeLibrary({ ...library, folders: [...library.folders, folder] });
  return folder;
}

export function renameFolder(id: string, name: string): void {
  const library = loadLibrary();
  writeLibrary({
    ...library,
    folders: library.folders.map((folder) =>
      folder.id === id ? { ...folder, name: folderName(name) } : folder,
    ),
  });
}

/**
 * Удалить папку. Всё, что в ней лежало, поднимается на ступень выше.
 *
 * Удаление папки — про порядок на полке, а не про данные: унести с собой
 * чужой год работы она не вправе. Поэтому отдельного «удалить вместе с
 * содержимым» здесь нет вовсе, а вложенные папки и профили переезжают к её
 * родителю — туда, где человек их и будет искать.
 */
export function deleteFolder(id: string): void {
  if (id === ROOT_FOLDER_ID) return;
  const library = loadLibrary();
  const parent = library.folders.find((folder) => folder.id === id)?.parentId ?? ROOT_FOLDER_ID;
  writeLibrary({
    folders: library.folders
      .filter((folder) => folder.id !== id)
      .map((folder) => (folder.parentId === id ? { ...folder, parentId: parent } : folder)),
    entries: library.entries.map((entry) =>
      entry.folderId === id ? { ...entry, folderId: parent } : entry,
    ),
  });
}

/**
 * Путь до папки — от grafik13 и вниз, включая её саму.
 *
 * Нужен хлебным крошкам: с вложенностью «назад» перестало означать
 * «в grafik13», и вернуться человек вправе на любую ступень.
 *
 * Глубина ограничена намеренно: в испорченном хранилище папка могла
 * оказаться собственной прародительницей, и обход без предела зациклил бы
 * страницу наглухо.
 */
export function folderPath(library: Library, id: string): LibraryFolder[] {
  const path: LibraryFolder[] = [];
  let current = library.folders.find((folder) => folder.id === id);
  while (current !== undefined && path.length < 32) {
    path.unshift(current);
    const parentId: string | null = current.parentId;
    current = parentId === null
      ? undefined
      : library.folders.find((folder) => folder.id === parentId);
  }
  return path;
}

export function moveEntry(entryId: string, folderId: string): void {
  const library = loadLibrary();
  if (!library.folders.some((folder) => folder.id === folderId)) return;
  writeLibrary({
    ...library,
    entries: library.entries.map((entry) =>
      entry.id === entryId ? { ...entry, folderId } : entry,
    ),
  });
}

/**
 * Переименовать запись — и сам профиль в ней.
 *
 * Имя записи в перечне — копия имени профиля, заведённая ради того, чтобы
 * показать список, не читая дюжину снимков целиком. Копия и оригинал
 * обязаны меняться вместе: разойдись они, и человек, открыв
 * «Подработку», увидел бы на странице «Мой график».
 *
 * Открытую запись этим путём не переименовывают: там имя правится на самой
 * странице, и отражение (`syncActiveIntoLibrary`) доносит его сюда само.
 */
export function renameEntry(entryId: string, name: string): void {
  const library = loadLibrary();
  const profile = readEntryProfile(entryId);
  if (profile !== null) writeEntryProfile(entryId, { ...profile, displayName: name });
  writeLibrary({
    ...library,
    entries: library.entries.map((entry) =>
      entry.id === entryId ? { ...entry, name } : entry,
    ),
  });
}

export function deleteEntry(entryId: string): void {
  const library = loadLibrary();
  remove(`${ENTRY_PREFIX}${entryId}`);
  writeLibrary({
    ...library,
    entries: library.entries.filter((entry) => entry.id !== entryId),
  });
}

/**
 * Имя папки из того, что набрал человек.
 *
 * Пустое имя — не отказ: папка человеку нужна, а не спор о названии.
 * Переводы строк и лишние пробелы убираются, потому что имя попадает в
 * строку списка, а не в текст.
 */
function folderName(raw: string): string {
  const safe = raw.replace(/\s+/g, " ").trim().slice(0, MAX_FOLDER_NAME_LENGTH);
  return safe === "" ? "Новая папка" : safe;
}
