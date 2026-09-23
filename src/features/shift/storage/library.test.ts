import { beforeEach, describe, expect, it } from "vitest";

import type { IsoDate } from "../domain/plain-date";
import {
  activeEntryId,
  createFolder,
  deleteFolder,
  detachActive,
  folderPath,
  forgetActive,
  freeName,
  importEntry,
  loadLibrary,
  moveEntry,
  nameTaken,
  openEntry,
  readEntryProfile,
  renameEntry,
  ROOT_FOLDER_ID,
  syncActiveIntoLibrary,
} from "./library";
import { createProfile, type StoredProfile } from "./profile";

/**
 * Проводник трогает то единственное место, где у человека лежит год
 * внесённых отпусков, и ошибка здесь не показывает неверное число, а молча
 * пишет один профиль поверх другого. Поэтому проверяется не UI, а именно
 * эти границы: где заводится запись, куда уходит следующая правка и что
 * остаётся от профиля после удаления.
 *
 * Хранилище подменяется картой: тесты идут без браузера (`environment:
 * node`), а сам разбор от этого не зависит — ему нужен только ключ и
 * строка.
 */
function stubWindow(): void {
  const cells = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => cells.get(key) ?? null,
      setItem: (key: string, value: string) => void cells.set(key, value),
      removeItem: (key: string) => void cells.delete(key),
    },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

function profileNamed(displayName: string): StoredProfile {
  return createProfile({
    displayName,
    workingConditions: "normal",
    disabilityGroupIorII: false,
    firstShiftDate: "2025-01-02" as IsoDate,
    accountingYear: 2025,
    shiftStartTime: "08:00",
    schedulePattern: "1|3",
    shiftDurationHours: "24",
    customWorkDays: 1,
    customRestDays: 3,
  });
}

beforeEach(stubWindow);

describe("профиль, заведённый до проводника", () => {
  it("становится записью в grafik13 сам, без переноса", () => {
    syncActiveIntoLibrary(profileNamed("Мой график"));

    const { folders, entries } = loadLibrary();
    expect(folders.map((folder) => folder.id)).toContain(ROOT_FOLDER_ID);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.folderId).toBe(ROOT_FOLDER_ID);
    expect(entries[0]!.name).toBe("Мой график");
    expect(activeEntryId()).toBe(entries[0]!.id);
  });

  it("при каждой следующей правке обновляет ту же запись, а не заводит вторую", () => {
    syncActiveIntoLibrary(profileNamed("Мой график"));
    const first = activeEntryId();

    syncActiveIntoLibrary({ ...profileNamed("Подработка"), savedAt: "2025-09-21T10:00:00.000Z" });

    const { entries } = loadLibrary();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe(first);
    expect(entries[0]!.name).toBe("Подработка");
    expect(entries[0]!.savedAt).toBe("2025-09-21T10:00:00.000Z");
  });
});

describe("смена открытого профиля", () => {
  it("уводит дальнейшие правки в открытую запись, не трогая прежнюю", () => {
    syncActiveIntoLibrary(profileNamed("Первый"));
    const first = activeEntryId()!;
    const second = importEntry(profileNamed("Второй"));

    expect(openEntry(second.id)?.displayName).toBe("Второй");
    syncActiveIntoLibrary({ ...profileNamed("Второй"), absences: [] });

    expect(activeEntryId()).toBe(second.id);
    expect(readEntryProfile(first)?.displayName).toBe("Первый");
  });

  it("не находит снимка у записи, которой нет, и указатель оставляет прежним", () => {
    syncActiveIntoLibrary(profileNamed("Первый"));
    const first = activeEntryId();

    expect(openEntry("никакой")).toBeNull();
    expect(activeEntryId()).toBe(first);
  });
});

describe("новый профиль", () => {
  it("после отвязки заводит свою запись, оставляя прежнюю целой", () => {
    syncActiveIntoLibrary(profileNamed("Первый"));
    const first = activeEntryId()!;

    detachActive();
    syncActiveIntoLibrary(profileNamed("Новый"));

    const { entries } = loadLibrary();
    expect(entries).toHaveLength(2);
    expect(readEntryProfile(first)?.displayName).toBe("Первый");
    expect(activeEntryId()).not.toBe(first);
  });
});

describe("удаление профиля с устройства", () => {
  it("уносит и запись, и снимок", () => {
    syncActiveIntoLibrary(profileNamed("Мой график"));
    const id = activeEntryId()!;

    forgetActive();

    expect(loadLibrary().entries).toHaveLength(0);
    expect(readEntryProfile(id)).toBeNull();
    expect(activeEntryId()).toBeNull();
  });
});

describe("папки", () => {
  it("удаление папки возвращает профили в grafik13, а не уносит их", () => {
    const entry = importEntry(profileNamed("Архивный"));
    const folder = createFolder("Архив");
    moveEntry(entry.id, folder.id);
    expect(loadLibrary().entries[0]!.folderId).toBe(folder.id);

    deleteFolder(folder.id);

    expect(loadLibrary().entries[0]!.folderId).toBe(ROOT_FOLDER_ID);
    expect(readEntryProfile(entry.id)?.displayName).toBe("Архивный");
  });

  it("папка заводится внутри другой, и путь до неё читается сверху вниз", () => {
    const outer = createFolder("Архив");
    const inner = createFolder("2024 год", outer.id);

    const path = folderPath(loadLibrary(), inner.id);

    expect(path.map((folder) => folder.name)).toEqual(["grafik13", "Архив", "2024 год"]);
  });

  it("удаление папки поднимает её содержимое на ступень выше, а не в самый верх", () => {
    const outer = createFolder("Архив");
    const inner = createFolder("2024 год", outer.id);
    const entry = importEntry(profileNamed("Прошлогодний"));
    moveEntry(entry.id, inner.id);

    deleteFolder(inner.id);

    const library = loadLibrary();
    expect(library.entries[0]!.folderId).toBe(outer.id);
    expect(library.folders.some((folder) => folder.id === inner.id)).toBe(false);
  });

  it("папка, чей родитель исчез, поднимается в grafik13 при чтении", () => {
    const orphan = createFolder("Сирота", "папки-такой-нет");

    expect(loadLibrary().folders.find((f) => f.id === orphan.id)?.parentId).toBe(
      ROOT_FOLDER_ID,
    );
  });

  it("grafik13 не удаляется: в ней оказываются профили изначально", () => {
    deleteFolder(ROOT_FOLDER_ID);

    expect(loadLibrary().folders.map((folder) => folder.id)).toContain(ROOT_FOLDER_ID);
  });

  it("запись из исчезнувшей папки возвращается в grafik13 при чтении", () => {
    const entry = importEntry(profileNamed("Потеряшка"));
    moveEntry(entry.id, "папки-такой-нет");

    expect(loadLibrary().entries[0]!.folderId).toBe(ROOT_FOLDER_ID);
  });
});

describe("имена профилей не повторяются", () => {
  it("занятое имя видно и с другим регистром, и с пробелами по краям", () => {
    importEntry(profileNamed("Основной"));

    expect(nameTaken("Основной")).toBe(true);
    expect(nameTaken("  основной ")).toBe(true);
    expect(nameTaken("Подработка")).toBe(false);
  });

  it("сама запись себе не помеха: имя можно оставить прежним", () => {
    const entry = importEntry(profileNamed("Основной"));

    expect(nameTaken("Основной", entry.id)).toBe(false);
  });

  it("свободное имя подбирается по порядку, а не подменяет занятое", () => {
    importEntry(profileNamed("Основной"));

    expect(freeName("Основной")).toBe("Основной (2)");

    importEntry(profileNamed("Основной (2)"));

    expect(freeName("Основной")).toBe("Основной (3)");
    expect(freeName("Подработка")).toBe("Подработка");
  });
});

describe("переименование записи", () => {
  it("меняет имя и в самом снимке профиля", () => {
    const entry = importEntry(profileNamed("Было"));

    renameEntry(entry.id, "Стало");

    expect(loadLibrary().entries[0]!.name).toBe("Стало");
    expect(readEntryProfile(entry.id)?.displayName).toBe("Стало");
  });
});

describe("испорченный перечень", () => {
  it("не роняет проводник и не уносит снимки", () => {
    const entry = importEntry(profileNamed("Уцелевший"));
    window.localStorage.setItem("shift-schedule.library", "{это не json");

    const library = loadLibrary();

    expect(library.folders.map((folder) => folder.id)).toEqual([ROOT_FOLDER_ID]);
    expect(library.entries).toEqual([]);
    expect(readEntryProfile(entry.id)?.displayName).toBe("Уцелевший");
  });
});
