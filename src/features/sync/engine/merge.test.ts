import { describe, expect, it } from "vitest";

import { createProfile, type StoredProfile } from "@/features/shift/storage/profile";

import type { IndexBody } from "./envelope";
import { mergeIndex, mergeProfile } from "./merge";

/**
 * Слияние — то место, где теряются чужие данные.
 *
 * Поэтому проверки здесь написаны не от кода, а от обещания контракта:
 * «молча не теряется ничего и никогда». Каждый тест — случай, в котором
 * потерять можно, и ответ на вопрос, что вместо этого произойдёт.
 */

const ЧАС = 60 * 60 * 1000;

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

function отпуск(id: string, startsOn: string, endsOn = startsOn) {
  return { id, kind: "sick_leave" as const, startsOn, endsOn };
}

describe("слияние профиля: записи с опознанием", () => {
  it("правки разных дней сходятся без вопросов — главный случай контракта", () => {
    // Телефон отметил больничный, компьютер поправил время смены.
    // Противоречия нет, и человека спрашивать не о чем.
    const base = профиль();
    const local = профиль({
      shiftStartTime: "09:00",
      savedAt: "2026-03-01T12:00:00.000Z",
    });
    const remote = профиль({
      absences: [отпуск("a1", "2026-03-03", "2026-03-07")],
      savedAt: "2026-03-01T11:00:00.000Z",
    });

    const { merged, notes, conflicts } = mergeProfile(base, local, remote);

    expect(conflicts).toEqual([]);
    expect(merged.shiftStartTime).toBe("09:00");
    expect(merged.absences).toHaveLength(1);
    expect(notes).toEqual([{ kind: "absences", taken: 1 }]);
  });

  it("новые записи с обеих сторон складываются", () => {
    const base = профиль();
    const local = профиль({ absences: [отпуск("a1", "2026-03-01")] });
    const remote = профиль({ absences: [отпуск("a2", "2026-04-01")] });

    const { merged } = mergeProfile(base, local, remote);

    expect(merged.absences.map((запись) => запись.id)).toEqual(["a1", "a2"]);
  });

  it("удаление побеждает: стёртое не воскресает", () => {
    // Удалить человек всегда успеет, а вот объяснять, почему удалённый
    // больничный вернулся сам, приложению нечем.
    const base = профиль({ absences: [отпуск("a1", "2026-03-01")] });
    const local = профиль({ absences: [] });
    const remote = профиль({ absences: [отпуск("a1", "2026-03-01")] });

    const { merged } = mergeProfile(base, local, remote);

    expect(merged.absences).toEqual([]);
  });

  it("правлено по-разному — берётся сторона с более свежим профилем", () => {
    const base = профиль({ absences: [отпуск("a1", "2026-03-01", "2026-03-05")] });
    const local = профиль({
      absences: [отпуск("a1", "2026-03-01", "2026-03-06")],
      savedAt: "2026-03-02T10:00:00.000Z",
    });
    const remote = профиль({
      absences: [отпуск("a1", "2026-03-01", "2026-03-09")],
      savedAt: "2026-03-03T10:00:00.000Z",
    });

    const { merged, notes } = mergeProfile(base, local, remote);

    expect(merged.absences[0]?.endsOn).toBe("2026-03-09");
    expect(notes).toContainEqual({ kind: "absences", taken: 1 });
  });

  it("вызовы сливаются по тому же правилу", () => {
    const вызов = {
      id: "c1",
      kind: "callout" as const,
      startsOn: "2026-03-04",
      endsOn: "2026-03-04",
      hoursPerDay: "4",
    };
    const { merged } = mergeProfile(профиль(), профиль(), профиль({ callouts: [вызов] }));

    expect(merged.callouts).toEqual([вызов]);
  });
});

describe("слияние профиля: отметки по датам", () => {
  it("заметки разных дней складываются, одного — берётся свежая", () => {
    const base = профиль({ dayNotes: { "2026-03-01": "было" } });
    const local = профиль({
      dayNotes: { "2026-03-01": "наше", "2026-03-02": "только тут" },
      savedAt: "2026-03-05T10:00:00.000Z",
    });
    const remote = профиль({
      dayNotes: { "2026-03-01": "чужое", "2026-03-03": "только там" },
      savedAt: "2026-03-06T10:00:00.000Z",
    });

    const { merged } = mergeProfile(base, local, remote);

    expect(merged.dayNotes).toEqual({
      "2026-03-01": "чужое",
      "2026-03-02": "только тут",
      "2026-03-03": "только там",
    });
  });

  it("стёртая отметка не возвращается", () => {
    const base = профиль({ shiftOverrides: { "2026-03-04": "off" } });
    const local = профиль({ shiftOverrides: {} });
    const remote = профиль({ shiftOverrides: { "2026-03-04": "off" } });

    const { merged } = mergeProfile(base, local, remote);

    expect(merged.shiftOverrides).toEqual({});
  });

  it("часы смен сливаются по дате заступления", () => {
    const local = профиль({ shiftTimes: { "2026-03-01": { startsAt: "08:00", endsAt: "20:00" } } });
    const remote = профиль({ shiftTimes: { "2026-03-05": { startsAt: "09:00", endsAt: "21:00" } } });

    const { merged } = mergeProfile(профиль(), local, remote);

    expect(Object.keys(merged.shiftTimes)).toEqual(["2026-03-01", "2026-03-05"]);
  });
});

describe("слияние профиля: настройки", () => {
  it("изменилась с одной стороны — берётся она, молча", () => {
    const base = профиль();
    const local = профиль();
    const remote = профиль({ accountingYear: 2027 });

    const { merged, conflicts, notes } = mergeProfile(base, local, remote);

    expect(conflicts).toEqual([]);
    expect(merged.accountingYear).toBe(2027);
    expect(notes).toContainEqual({ kind: "settings", taken: 1 });
  });

  it("изменилась с обеих и по-разному — это вопрос человеку", () => {
    const base = профиль({ schedulePattern: "1|3" });
    const local = профиль({ schedulePattern: "2|2" });
    const remote = профиль({ schedulePattern: "5|2" });

    const { conflicts } = mergeProfile(base, local, remote);

    expect(conflicts).toEqual([
      { field: "schedulePattern", local: "2|2", remote: "5|2" },
    ]);
  });

  it("без базового состояния всякое расхождение настроек — вопрос", () => {
    // Элемент на сервере есть, а у нас его ревизии нет: сверять не с чем,
    // и решать за человека нельзя.
    const { conflicts } = mergeProfile(
      null,
      профиль({ firstShiftDate: "2026-01-02" }),
      профиль({ firstShiftDate: "2026-01-03" }),
    );

    expect(conflicts.map((спор) => спор.field)).toEqual(["firstShiftDate"]);
  });

  it("при ответе «взять оттуда» спорное поле берётся с другого устройства", () => {
    const base = профиль({ weeklyNormHours: null });
    const local = профиль({ weeklyNormHours: "36" });
    const remote = профиль({ weeklyNormHours: "39" });

    const свой = mergeProfile(base, local, remote, { prefer: "local" });
    const чужой = mergeProfile(base, local, remote, { prefer: "remote" });

    expect(свой.merged.weeklyNormHours).toBe("36");
    expect(чужой.merged.weeklyNormHours).toBe("39");
    // Расхождение названо в обоих случаях: ответ человека не делает его
    // несуществующим, он только выбирает сторону.
    expect(свой.conflicts).toHaveLength(1);
    expect(чужой.conflicts).toHaveLength(1);
  });

  it("о двух переключателях вида не спрашивают", () => {
    // «Веду табель» — это не данные, а то, в каком виде человек смотрит
    // на свои. Окно из-за тумблера приучило бы закрывать окна не читая.
    const base = профиль({ liveMode: false, overtimeInDays: false });
    const local = профиль({ liveMode: true, savedAt: "2026-03-01T10:00:00.000Z" });
    const remote = профиль({ overtimeInDays: true, savedAt: "2026-03-02T10:00:00.000Z" });

    const { merged, conflicts } = mergeProfile(base, local, remote);

    expect(conflicts).toEqual([]);
    expect(merged.liveMode).toBe(true);
    expect(merged.overtimeInDays).toBe(true);
  });

  it("слитое новее обеих сторон", () => {
    // Иначе следующее слияние на другом устройстве решило бы, что свежее
    // как раз то, что мы только что переписали.
    const local = профиль({ savedAt: "2026-03-01T10:00:00.000Z" });
    const remote = профиль({ savedAt: "2026-03-02T10:00:00.000Z" });

    const { merged } = mergeProfile(профиль(), local, remote);

    expect(Date.parse(merged.savedAt)).toBeGreaterThanOrEqual(Date.parse(remote.savedAt));
  });
});

describe("слияние указателя", () => {
  const время = (сдвиг: number) => new Date(Date.parse("2026-03-01T10:00:00.000Z") + сдвиг).toISOString();

  function указатель(правки: Partial<IndexBody> = {}): IndexBody {
    return {
      folders: [{ id: "grafik13", name: "grafik13", parentId: null, updatedAt: время(0) }],
      entries: [],
      ...правки,
    };
  }

  it("папки и записи с обеих сторон складываются", () => {
    const base = указатель();
    const local = указатель({
      folders: [
        ...указатель().folders,
        { id: "f1", name: "4-й караул", parentId: "grafik13", updatedAt: время(ЧАС) },
      ],
    });
    const remote = указатель({
      entries: [
        { id: "e1", folderId: "grafik13", name: "Петров", savedAt: время(ЧАС), updatedAt: время(ЧАС) },
      ],
    });

    const { merged, notes } = mergeIndex(base, local, remote);

    expect(merged.folders.map((папка) => папка.id)).toEqual(["grafik13", "f1"]);
    expect(merged.entries.map((запись) => запись.id)).toEqual(["e1"]);
    expect(notes).toContainEqual({ kind: "entries", taken: 1 });
  });

  it("имя берётся с более свежей правки", () => {
    const папка = { id: "f1", parentId: "grafik13" };
    const base = указатель({
      folders: [...указатель().folders, { ...папка, name: "Караул", updatedAt: время(0) }],
    });
    const local = указатель({
      folders: [...указатель().folders, { ...папка, name: "Первый караул", updatedAt: время(ЧАС) }],
    });
    const remote = указатель({
      folders: [...указатель().folders, { ...папка, name: "4-й караул", updatedAt: время(2 * ЧАС) }],
    });

    const { merged } = mergeIndex(base, local, remote);

    expect(merged.folders[1]?.name).toBe("4-й караул");
  });

  it("удалённая папка не возвращается, а её записи поднимаются в корень", () => {
    const папка = { id: "f1", name: "Караул", parentId: "grafik13", updatedAt: время(0) };
    const запись = {
      id: "e1",
      folderId: "f1",
      name: "Петров",
      savedAt: время(0),
      updatedAt: время(0),
    };

    const base = указатель({ folders: [...указатель().folders, папка], entries: [запись] });
    const local = указатель({ entries: [запись] });
    const remote = указатель({ folders: [...указатель().folders, папка], entries: [запись] });

    const { merged } = mergeIndex(base, local, remote);

    expect(merged.folders.map((f) => f.id)).toEqual(["grafik13"]);
    expect(merged.entries[0]?.folderId).toBe("grafik13");
  });
});
