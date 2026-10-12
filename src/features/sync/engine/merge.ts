/**
 * Слияние: трёхсторонняя сверка `base` ↔ `local` ↔ `remote`.
 *
 * Сервер только сообщает о расхождении — сливает браузер, по правилам
 * раздела 5 контракта. `base` — состояние на момент подтверждённой
 * сервером ревизии; без него любая одновременная правка выглядела бы
 * конфликтом, даже когда устройства меняли разные дни.
 *
 * --- Три природы данных, три правила ---------------------------------------
 *
 * | Что | Правило |
 * |---|---|
 * | Записи с опознанием (отпуска, вызовы) | Объединение по `id`; было в `base` и пропало с одной стороны — удаление побеждает; правлено по-разному — сторона с более свежим `savedAt` |
 * | Отметки по датам (заметки, правки календаря, свои смены и часы) | То же по ключу-дате |
 * | Настройки профиля (график, норма, дата смены, имя, год) | Изменились с одной стороны — берётся она; с обеих и по-разному — **спрашиваем человека** |
 *
 * --- Почему о двух переключателях не спрашивают ----------------------------
 *
 * «Веду табель» и «переработка в сменах» — это не данные, а то, в каком
 * виде человек привык смотреть на свои. Расхождение в них ничего не
 * теряет, а окно «на другом устройстве этот профиль настроен иначе» из-за
 * тумблера приучило бы закрывать такое окно не читая — и закрыть его не
 * читая человек однажды успел бы и с графиком. Поэтому здесь берётся
 * более свежая сторона и об этом говорится строкой в сводке.
 *
 * --- Чего слияние не делает ------------------------------------------------
 *
 * Не решает за человека там, где решить нельзя, и не теряет молча ничего.
 * Если расхождение в настройках есть, оно возвращается списком: вызывающий
 * (`sync.ts`) не применяет такой элемент вовсе, а откладывает вопрос до
 * ответа человека.
 */

import type { StoredProfile } from "@/features/shift/storage/profile";

import { deepEqual } from "./deep-equal";
import type { IndexBody } from "./envelope";

/** Что принято с другой стороны — для спокойной строки в сводке. */
export interface MergeNote {
  kind:
    | "absences"
    | "callouts"
    | "calendarOverrides"
    | "shiftOverrides"
    | "shiftTimes"
    | "dayNotes"
    | "settings"
    | "folders"
    | "entries";
  /** Сколько значений пришло с другой стороны. */
  taken: number;
}

/** Поле настроек, в котором стороны разошлись по-разному. */
export interface SettingConflict {
  field: SettingField;
  local: unknown;
  remote: unknown;
}

export interface ProfileMerge {
  merged: StoredProfile;
  notes: MergeNote[];
  /** Непусто — значит решать человеку, а не нам. */
  conflicts: SettingConflict[];
}

/**
 * Настройки, расхождение в которых — вопрос человеку.
 *
 * Перечислены руками, а не выведены из схемы: новое поле профиля должно
 * попадать сюда осознанно. Забытое поле слияние возьмёт по правилу
 * «более свежая сторона» (см. `ОСТАЛЬНОЕ`), и это мягкий, а не опасный
 * исход — но для настройки, меняющей расчёт, выбор обязан быть за
 * человеком.
 */
const СПОРНЫЕ = [
  "displayName",
  "workingConditions",
  "disabilityGroupIorII",
  "firstShiftDate",
  "countFrom",
  "shiftStartTime",
  "schedulePattern",
  "customWorkDays",
  "customRestDays",
  "shiftDurationHours",
  "weeklyNormHours",
  "accountingYear",
] as const;

/** Предпочтения вида: расхождение решается свежестью, молча. */
const ПРЕДПОЧТЕНИЯ = ["liveMode", "overtimeInDays"] as const;

export type SettingField = (typeof СПОРНЫЕ)[number];

interface WithId {
  id: string;
}

/**
 * Слить профиль.
 *
 * `base` — `null`, когда элемента на сервере раньше не было, а он там
 * оказался: так бывает, когда одно устройство завело профиль, а второе
 * ещё не знало о нём. Сверять тогда не с чем, и всякое расхождение
 * настроек считается противоречием — то есть вопросом человеку.
 */
export function mergeProfile(
  base: StoredProfile | null,
  local: StoredProfile,
  remote: StoredProfile,
  options: { prefer?: "local" | "remote" } = {},
): ProfileMerge {
  const свежее: "local" | "remote" =
    Date.parse(remote.savedAt) > Date.parse(local.savedAt) ? "remote" : "local";
  const prefer = options.prefer ?? свежее;

  const notes: MergeNote[] = [];
  const conflicts: SettingConflict[] = [];
  const merged: StoredProfile = { ...local };

  // Поля перечислены по одному, а не циклом по именам: у каждого свой
  // тип значения, и проверке типов нужно видеть, какой именно. Цикл
  // пришлось бы заткнуть приведением — то есть отключить проверку ровно
  // там, где она защищает от «часы смены легли в заметки дня».
  const запись = <T extends WithId>(
    kind: MergeNote["kind"],
    вБазе: readonly T[] | null,
    тут: readonly T[],
    там: readonly T[],
  ): T[] => {
    const { значение, принято } = сливЗаписи(вБазе, тут, там, свежее);
    if (принято > 0) notes.push({ kind, taken: принято });
    return значение;
  };

  const карта_ = <T>(
    kind: MergeNote["kind"],
    вБазе: Readonly<Record<string, T>> | null,
    тут: Readonly<Record<string, T>>,
    там: Readonly<Record<string, T>>,
  ): Record<string, T> => {
    const { значение, принято } = сливКарту(вБазе, тут, там, свежее);
    if (принято > 0) notes.push({ kind, taken: принято });
    return значение;
  };

  merged.absences = запись("absences", base?.absences ?? null, local.absences, remote.absences);
  merged.callouts = запись("callouts", base?.callouts ?? null, local.callouts, remote.callouts);
  merged.calendarOverrides = карта_(
    "calendarOverrides",
    base?.calendarOverrides ?? null,
    local.calendarOverrides,
    remote.calendarOverrides,
  );
  merged.shiftOverrides = карта_(
    "shiftOverrides",
    base?.shiftOverrides ?? null,
    local.shiftOverrides,
    remote.shiftOverrides,
  );
  merged.shiftTimes = карта_(
    "shiftTimes",
    base?.shiftTimes ?? null,
    local.shiftTimes,
    remote.shiftTimes,
  );
  merged.dayNotes = карта_(
    "dayNotes",
    base?.dayNotes ?? null,
    local.dayNotes,
    remote.dayNotes,
  );

  let настроекПринято = 0;

  for (const поле of СПОРНЫЕ) {
    const решение = сливНастройку(base?.[поле], local[поле], remote[поле], base !== null);

    if (решение === "conflict") {
      conflicts.push({ field: поле, local: local[поле], remote: remote[поле] });
      // Пока человек не ответил, в слитом остаётся то, что он выбрал
      // своим `prefer`: вызывающий этот результат либо применит после
      // ответа, либо отложит целиком.
      if (prefer === "remote") {
        Object.assign(merged, { [поле]: remote[поле] });
        настроекПринято += 1;
      }
      continue;
    }

    if (решение === "remote") {
      Object.assign(merged, { [поле]: remote[поле] });
      настроекПринято += 1;
    }
  }

  for (const поле of ПРЕДПОЧТЕНИЯ) {
    if (local[поле] === remote[поле]) continue;

    const решение = сливНастройку(base?.[поле], local[поле], remote[поле], base !== null);
    const берём = решение === "conflict" ? свежее : решение;

    if (берём === "remote") {
      Object.assign(merged, { [поле]: remote[поле] });
      настроекПринято += 1;
    }
  }

  if (настроекПринято > 0) notes.push({ kind: "settings", taken: настроекПринято });

  // Слитое — новее обеих сторон: иначе следующее слияние на другом
  // устройстве решило бы, что свежее как раз то, что мы только что
  // переписали.
  merged.savedAt = новееИз(local.savedAt, remote.savedAt);

  return { merged, notes, conflicts };
}

function сливНастройку(
  base: unknown,
  local: unknown,
  remote: unknown,
  есть_база: boolean,
): "local" | "remote" | "conflict" {
  if (deepEqual(local, remote)) return "local";
  if (!есть_база) return "conflict";
  if (deepEqual(local, base)) return "remote";
  if (deepEqual(remote, base)) return "local";
  return "conflict";
}

function сливЗаписи<T extends WithId>(
  base: readonly T[] | null,
  local: readonly T[],
  remote: readonly T[],
  свежее: "local" | "remote",
): { значение: T[]; принято: number } {
  const вБазе = карта(base ?? []);
  const наше = карта(local);
  const чужое = карта(remote);

  const значение: T[] = [];
  let принято = 0;

  for (const id of порядок(local, remote)) {
    const было = вБазе.get(id);
    const тут = наше.get(id);
    const там = чужое.get(id);

    // Удаление побеждает: было подтверждено сервером и пропало с одной
    // стороны — значит человек это стёр. Воскрешать стёртое приложение не
    // вправе.
    if (было !== undefined && (тут === undefined || там === undefined)) continue;

    if (тут === undefined && там !== undefined) {
      значение.push(там);
      принято += 1;
      continue;
    }

    if (тут !== undefined && там === undefined) {
      значение.push(тут);
      continue;
    }

    if (тут === undefined || там === undefined) continue;

    if (deepEqual(тут, там)) {
      значение.push(тут);
      continue;
    }

    // Правлено с двух сторон по-разному: берётся сторона с более свежим
    // профилем. Запись отпуска — не настройка: обе версии правдоподобны,
    // и спрашивать о каждой означало бы спрашивать о двадцати.
    if (свежее === "remote") {
      значение.push(там);
      принято += 1;
    } else {
      значение.push(тут);
    }
  }

  return { значение, принято };
}

function сливКарту<T>(
  base: Readonly<Record<string, T>> | null,
  local: Readonly<Record<string, T>>,
  remote: Readonly<Record<string, T>>,
  свежее: "local" | "remote",
): { значение: Record<string, T>; принято: number } {
  const значение: Record<string, T> = {};
  let принято = 0;

  const ключи = [...new Set([...Object.keys(local), ...Object.keys(remote)])].sort();

  for (const ключ of ключи) {
    const было = base !== null && Object.hasOwn(base, ключ);
    const тут = Object.hasOwn(local, ключ);
    const там = Object.hasOwn(remote, ключ);

    if (было && (!тут || !там)) continue;

    if (!тут && там) {
      значение[ключ] = remote[ключ] as T;
      принято += 1;
      continue;
    }

    if (тут && !там) {
      значение[ключ] = local[ключ] as T;
      continue;
    }

    if (deepEqual(local[ключ], remote[ключ])) {
      значение[ключ] = local[ключ] as T;
      continue;
    }

    if (свежее === "remote") {
      значение[ключ] = remote[ключ] as T;
      принято += 1;
    } else {
      значение[ключ] = local[ключ] as T;
    }
  }

  return { значение, принято };
}

export interface IndexMerge {
  merged: IndexBody;
  notes: MergeNote[];
}

/**
 * Слить указатель библиотеки: папки и перечень записей.
 *
 * Правило одно на оба списка — объединение по `id`, имя и место с более
 * свежим `updatedAt`, — и одно исключение: удаление побеждает. Записи из
 * удалённой папки поднимаются в корень, как и при локальном удалении:
 * в них лежит чей-то год работы.
 */
export function mergeIndex(
  base: IndexBody | null,
  local: IndexBody,
  remote: IndexBody,
): IndexMerge {
  const notes: MergeNote[] = [];

  const папки = сливПоВремени(base?.folders ?? null, local.folders, remote.folders);
  const записи = сливПоВремени(base?.entries ?? null, local.entries, remote.entries);

  if (папки.принято > 0) notes.push({ kind: "folders", taken: папки.принято });
  if (записи.принято > 0) notes.push({ kind: "entries", taken: записи.принято });

  const корень = папки.значение.map((папка) => папка.id);
  const известные = new Set(корень);

  return {
    merged: {
      folders: папки.значение,
      // Запись, чья папка исчезла, возвращается в grafik13 — тем же
      // правилом, что и при локальном удалении папки (`loadLibrary`).
      entries: записи.значение.map((запись) =>
        известные.has(запись.folderId) ? запись : { ...запись, folderId: "grafik13" },
      ),
    },
    notes,
  };
}

function сливПоВремени<T extends WithId & { updatedAt: string }>(
  base: readonly T[] | null,
  local: readonly T[],
  remote: readonly T[],
): { значение: T[]; принято: number } {
  const вБазе = карта(base ?? []);
  const наше = карта(local);
  const чужое = карта(remote);

  const значение: T[] = [];
  let принято = 0;

  for (const id of порядок(local, remote)) {
    const было = вБазе.get(id);
    const тут = наше.get(id);
    const там = чужое.get(id);

    if (было !== undefined && (тут === undefined || там === undefined)) continue;

    if (тут === undefined && там !== undefined) {
      значение.push(там);
      принято += 1;
      continue;
    }

    if (тут !== undefined && там === undefined) {
      значение.push(тут);
      continue;
    }

    if (тут === undefined || там === undefined) continue;

    if (deepEqual(тут, там)) {
      значение.push(тут);
      continue;
    }

    // Строки различаются только временем правки — значит не различаются
    // вовсе: `updatedAt` ведёт слой синхронизации, а не человек. Берётся
    // чужая, чтобы стороны сошлись на одном значении и перестали гонять
    // друг другу одно и то же: иначе вход на новом устройстве поднимал бы
    // ревизию указателя, не изменив в нём ни имени, ни места.
    if (deepEqual(безВремени(тут), безВремени(там))) {
      значение.push(там);
      continue;
    }

    if (Date.parse(там.updatedAt) > Date.parse(тут.updatedAt)) {
      значение.push(там);
      принято += 1;
    } else {
      значение.push(тут);
    }
  }

  return { значение, принято };
}

function безВремени<T extends { updatedAt: string }>(строка: T): Omit<T, "updatedAt"> {
  const остальное: Record<string, unknown> = { ...строка };
  delete остальное.updatedAt;
  return остальное as Omit<T, "updatedAt">;
}

function карта<T extends WithId>(список: readonly T[]): Map<string, T> {
  return new Map(список.map((значение) => [значение.id, значение]));
}

/** Опознания из обоих списков: сначала наши по порядку, потом чужие новые. */
function порядок<T extends WithId>(local: readonly T[], remote: readonly T[]): string[] {
  const ids = local.map((значение) => значение.id);
  const известные = new Set(ids);

  for (const значение of remote) {
    if (!известные.has(значение.id)) ids.push(значение.id);
  }

  return ids;
}

function новееИз(первый: string, второй: string): string {
  return Date.parse(второй) > Date.parse(первый) ? второй : первый;
}
