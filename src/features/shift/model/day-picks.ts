import { parseHours } from "../domain/decimal";
import type { IsoDate } from "../domain/plain-date";
import { ABSENCE_LABELS, CALLOUT_LABELS } from "../schemas";
import type { AbsenceKind, CalloutKind } from "../domain/value-objects";
import type { StoredProfile } from "../storage/profile";

/**
 * Виды суток, которые человек включает тумблером в окне дня.
 *
 * --- Почему это отдельный модуль -------------------------------------------
 *
 * Знают о них двое. Окно дня (`day-editor.tsx`) — оно эти виды включает и
 * выключает. И рабочий экран (`workspace.tsx`) — потому что конец события
 * выбирается НА САМОЙ СЕТКЕ, а сетка живёт там, снаружи окна.
 *
 * Пока запись велась только из окна, всё это лежало в нём же. Как только за
 * тот же профиль взялся второй, потребовалось общее место: две копии правил
 * «как записывается отпуск» разошлись бы при первой же правке, и сетка
 * заводила бы вторую запись там, где окно правит первую.
 */

/** Вид суток: отсутствие или работа помимо графика — с его разновидностью. */
export type DayPick = `absence:${AbsenceKind}` | `callout:${CalloutKind}`;

/** Время такого вида: по какое число он длится и сколько часов в сутки. */
export interface DayTime {
  endsOn: IsoDate;
  /** Только у вызова: у отсутствия часов нет, поле их не спрашивает. */
  hours: string;
}

/** Отсутствие или вызов — по началу опознавателя. */
export function pickSort(pick: DayPick): "absence" | "callout" {
  return pick.startsWith("absence:") ? "absence" : "callout";
}

/** Разновидность внутри вида: «annual_leave», «reserve» и так далее. */
export function pickKind(pick: DayPick): string {
  return pick.slice(pick.indexOf(":") + 1);
}

/** Название вида по-русски — тем же словом, что в легенде и на сетке. */
export function pickLabel(pick: DayPick): string {
  return pickSort(pick) === "absence"
    ? ABSENCE_LABELS[pickKind(pick) as AbsenceKind]
    : CALLOUT_LABELS[pickKind(pick) as CalloutKind];
}

/**
 * Запись этого вида, накрывающая эти сутки, — если она есть.
 *
 * Ищется именно НАКРЫВАЮЩАЯ, а не начинающаяся здесь: открыв середину
 * отпуска с 1 по 14, человек правит тот самый отпуск, у которого начало
 * раньше открытых суток.
 */
export function pickCovering(
  profile: StoredProfile,
  day: IsoDate,
  pick: DayPick,
): { id: string; startsOn: string; endsOn: string } | null {
  const kind = pickKind(pick);
  const list = pickSort(pick) === "absence" ? profile.absences : profile.callouts;
  return list.find((item) => item.kind === kind && item.startsOn <= day && day <= item.endsOn) ?? null;
}

/**
 * Записать вид суток: добавить новый или поправить уже стоящий.
 *
 * Правка, а не вторая запись, — потому что запись у вида одна на весь его
 * срок. Открыв середину отпуска с 1 по 14 и продлив его до 20, человек
 * меняет ту же самую запись: у неё остаются и опознаватель, и дата начала,
 * которая может быть раньше открытых суток. Добавить рядом вторую значило
 * бы удвоить отпуск.
 */
export function withDayPick(
  profile: StoredProfile,
  day: IsoDate,
  pick: DayPick,
  time: DayTime,
): StoredProfile {
  const end = time.endsOn;
  const edited = pickCovering(profile, day, pick);

  if (pickSort(pick) === "absence") {
    const kind = pickKind(pick) as AbsenceKind;
    return edited
      ? {
          ...profile,
          absences: profile.absences.map((item) =>
            item.id === edited.id ? { ...item, endsOn: end } : item,
          ),
        }
      : {
          ...profile,
          absences: [
            ...profile.absences,
            { id: crypto.randomUUID(), kind, startsOn: day, endsOn: end },
          ],
        };
  }

  const kind = pickKind(pick) as CalloutKind;
  const parsed = parseHours(time.hours);
  // Часы у вызова обязательны: без них запись не имеет смысла, а негодное
  // значение (пустое поле, «полторы буквы») профилю не нужно вовсе.
  if (parsed === null) return profile;
  return edited
    ? {
        ...profile,
        callouts: profile.callouts.map((item) =>
          item.id === edited.id
            ? { ...item, endsOn: end, hoursPerDay: parsed.toString() }
            : item,
        ),
      }
    : {
        ...profile,
        callouts: [
          ...profile.callouts,
          {
            id: crypto.randomUUID(),
            kind,
            startsOn: day,
            endsOn: end,
            hoursPerDay: parsed.toString(),
          },
        ],
      };
}

/**
 * Продлить уже стоящую запись по названное число включительно.
 *
 * Этим кончается выбор конца события на сетке: запись к этому моменту уже
 * есть — её завёл тумблер, одними сутками, — и остаётся только сдвинуть её
 * правый край. Ничего не найдя, профиль возвращается как есть: запись мог
 * убрать кто-то ещё, пока человек водил мышью по календарю.
 */
export function withPickEnd(
  profile: StoredProfile,
  day: IsoDate,
  pick: DayPick,
  endsOn: IsoDate,
): StoredProfile {
  const covering = pickCovering(profile, day, pick);
  if (covering === null || endsOn < day) return profile;
  return pickSort(pick) === "absence"
    ? {
        ...profile,
        absences: profile.absences.map((item) =>
          item.id === covering.id ? { ...item, endsOn } : item,
        ),
      }
    : {
        ...profile,
        callouts: profile.callouts.map((item) =>
          item.id === covering.id ? { ...item, endsOn } : item,
        ),
      };
}
