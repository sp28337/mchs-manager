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
  importProfileFile,
  librarySnapshot,
  loadLibrary,
  moveEntry,
  nameTaken,
  openEntry,
  openProfileFile,
  profileFileText,
  readEntryProfile,
  readLibraryFile,
  renameEntry,
  ROOT_FOLDER_ID,
  syncActiveIntoLibrary,
} from "./library";
import { createProfile, importProfile, type StoredProfile } from "./profile";

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

/**
 * Папки в файле профиля.
 *
 * Здесь проверяется то, ради чего всё и заведено: файл, сохранённый на
 * одном устройстве, восстанавливает на другом не один график, а весь
 * проводник — с папками, вложенностью и остальными профилями. И второе,
 * не менее важное: при этом НИЧЕГО не перезаписывается, потому что открытый
 * файл годичной давности иначе стирал бы полгода работы.
 */
describe("папки в файле профиля", () => {
  /** Проводник одного устройства: две папки вложенно и два профиля. */
  function deviceWithFolders(): { guard: string; year: string } {
    const guard = createFolder("Караул 1").id;
    const year = createFolder("2025", guard).id;
    syncActiveIntoLibrary(profileNamed("Мой график"));
    moveEntry(loadLibrary().entries[0]!.id, year);
    importEntry(profileNamed("Подработка"), guard);
    return { guard, year };
  }

  it("в снимок идут папки и ЧУЖИЕ профили, а открытый — нет", () => {
    const { year } = deviceWithFolders();

    const snapshot = librarySnapshot()!;

    expect(snapshot.folders.map((folder) => folder.name)).toEqual(["Караул 1", "2025"]);
    expect(snapshot.entries.map((entry) => entry.name)).toEqual(["Подработка"]);
    expect(snapshot.entries[0]!.profile.displayName).toBe("Подработка");
    // Папка открытого профиля — единственное, что от его записи остаётся:
    // сам он лежит в файле верхним уровнем и свежее своего снимка.
    expect(snapshot.folderId).toBe(year);
  });

  it("у одного профиля без папок снимка нет вовсе", () => {
    syncActiveIntoLibrary(profileNamed("Мой график"));

    expect(librarySnapshot()).toBeNull();
  });

  it("файл с папками остаётся обычным файлом профиля", () => {
    deviceWithFolders();

    const text = profileFileText(profileNamed("Мой график"));

    // Прежняя версия приложения возьмёт из такого файла профиль и не
    // заметит приписки: незнакомые поля разбор отбрасывает.
    expect(importProfile(text).displayName).toBe("Мой график");
    expect(readLibraryFile(text)?.folders).toHaveLength(2);
  });

  it("файл без папок и испорченная приписка читаются как «папок нет»", () => {
    expect(readLibraryFile(profileFileText(profileNamed("Один")))).toBeNull();
    expect(readLibraryFile('{"library":{"folders":"не список"}}')).toBeNull();
    expect(readLibraryFile("{это не json")).toBeNull();
  });

  it("на другом устройстве восстанавливает папки, вложенность и профили", () => {
    deviceWithFolders();
    const file = readLibraryFile(profileFileText(profileNamed("Мой график")));

    // Другое устройство: хранилище пустое.
    stubWindow();
    const imported = importProfileFile(profileNamed("Мой график"), file);

    const { folders, entries } = loadLibrary();
    const guard = folders.find((folder) => folder.name === "Караул 1")!;
    const year = folders.find((folder) => folder.name === "2025")!;
    expect(folders).toHaveLength(3);
    expect(guard.parentId).toBe(ROOT_FOLDER_ID);
    expect(year.parentId).toBe(guard.id);
    expect(imported).toMatchObject({ folders: 2, entries: 1, skipped: 0 });
    // Профиль из файла встаёт в ту папку, в которой лежал, — ради этого
    // папки и переносятся.
    expect(entries.find((entry) => entry.name === "Мой график")!.folderId).toBe(year.id);
    expect(entries.find((entry) => entry.name === "Подработка")!.folderId).toBe(guard.id);
    expect(readEntryProfile(entries[0]!.id)).not.toBeNull();
  });

  it("на СВОЁМ устройстве ничего не перезаписывает, а приходит копиями", () => {
    const { year } = deviceWithFolders();
    const file = readLibraryFile(profileFileText(profileNamed("Мой график")));
    const before = loadLibrary();

    const imported = importProfileFile(profileNamed("Мой график"), file);

    const { folders, entries } = loadLibrary();
    // Старые папки и записи целы — опознания у пришедших свои.
    for (const old of before.entries) {
      expect(entries.some((entry) => entry.id === old.id && entry.name === old.name)).toBe(true);
    }
    expect(folders).toHaveLength(5);
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      "Мой график",
      "Мой график (2)",
      "Подработка",
      "Подработка (2)",
    ]);
    // Копия легла в копию своей папки, а не в чужую исходную.
    expect(imported.entry.name).toBe("Мой график (2)");
    expect(imported.entry.folderId).not.toBe(year);
    expect(readEntryProfile(imported.entry.id)?.displayName).toBe("Мой график (2)");
  });

  it("без папок в файле ведёт себя как обычная загрузка профиля", () => {
    const imported = importProfileFile(profileNamed("Из файла"), null);

    expect(loadLibrary().entries.map((entry) => entry.name)).toEqual(["Из файла"]);
    expect(imported).toMatchObject({ folders: 0, entries: 0, skipped: 0 });
    expect(imported.entry.folderId).toBe(ROOT_FOLDER_ID);
  });

  it("открытым профилем файл становится без второй записи рядом", () => {
    importEntry(profileNamed("Мой график"));

    const opened = openProfileFile(profileNamed("Мой график"), null);

    // Указатель стоит на пришедшей записи, поэтому первая же запись
    // профиля обновит её, а не заведёт рядом ещё одну.
    expect(opened.displayName).toBe("Мой график (2)");
    expect(activeEntryId()).toBe(loadLibrary().entries[1]!.id);
    syncActiveIntoLibrary(opened);
    expect(loadLibrary().entries).toHaveLength(2);
  });
});
