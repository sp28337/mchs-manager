import { describe, expect, it } from "vitest";

import { buildChange, changeParams } from "./changes";
import { changeSchema } from "./diff";
import { listArchivedVersions, loadArchivedBody, loadLegalDocument } from "./documents";

/**
 * Архив редакций и сравнение — на настоящих файлах из `docs/legal/`.
 *
 * Сравнение собирается на сборке по каждой архивной редакции, и ломаться оно
 * должно здесь, а не у человека в окне «Документы обновились».
 */
describe("архив редакций", () => {
  it("у согласия есть прежняя редакция, с которой сравнивают", () => {
    expect(listArchivedVersions("consent")).toContain("2026-10-11");
  });

  it("архивная редакция читается без головного блока", () => {
    const body = loadArchivedBody("consent", "2026-10-11");

    expect(body).not.toBeNull();
    expect(body).not.toContain("version:");
    expect(body).toContain("Согласие на обработку персональных данных");
  });

  it("версия из адреса проверяется как дата: чужой путь не читается", () => {
    expect(loadArchivedBody("consent", "../../consent")).toBeNull();
    expect(loadArchivedBody("consent", "2026-10-11.md")).toBeNull();
    expect(loadArchivedBody("consent", "1999-01-01")).toBeNull();
  });

  it("чужая редакция под своим именем не подходит", () => {
    // Редакция политики не должна читаться как редакция согласия.
    expect(loadArchivedBody("policy", "2026-10-11")).toBeNull();
  });
});

describe("сравнение с действующей редакцией", () => {
  it("согласие 2026-10-11 → действующее: правки есть и укладываются в форму ответа", () => {
    const change = buildChange("consent", "2026-10-11");

    expect(change).not.toBeNull();
    expect(() => changeSchema.parse(change)).not.toThrow();

    expect(change?.from).toBe("2026-10-11");
    expect(change?.to).toBe(loadLegalDocument("consent").version);
    expect(change?.blocks.length).toBeGreaterThan(0);
    // Неизменившееся не выводится, а считается.
    expect(change?.unchanged).toBeGreaterThan(0);
  });

  it("называет хостинг-провайдера: это добавленный текст, а не мозаика слов", () => {
    const change = buildChange("consent", "2026-10-11");
    const text = JSON.stringify(change?.blocks);

    expect(text).toContain("хостинг-провайдер");
  });

  it("с редакцией, которой в архиве нет, сравнивать не с чем", () => {
    expect(buildChange("consent", "1999-01-01")).toBeNull();
  });

  it("с самой собой не сравнивается", () => {
    expect(buildChange("consent", loadLegalDocument("consent").version)).toBeNull();
  });

  it("на сборке собираются все архивные редакции, кроме действующей", () => {
    const params = changeParams();

    expect(params).toContainEqual({ id: "consent", from: "2026-10-11" });
    for (const { id, from } of params) {
      expect(from).not.toBe(loadLegalDocument(id).version);
    }
  });
});
