import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { LEGAL_VERSIONS } from "../sync/legal";
import { LEGAL_FILES, loadLegalDocument, type LegalId } from "./documents";

/**
 * Документы на сайте и документы в коде — одно и то же.
 *
 * Текст лежит в `docs/legal/*.md` и читается на сборке. Разойдись он с
 * манифестом сервера или с версиями, которые браузер отправляет при
 * регистрации, — и запись о согласии будет ссылаться на редакцию, которой
 * не существует. Тот же набор проверок стоит на сервере
 * (`api/tests/test_legal.py`) и в `scripts/legal.mjs`: сходятся три
 * независимых счёта.
 */
const МАНИФЕСТ = JSON.parse(
  readFileSync("api/src/grafik_api/core/legal_manifest.json", "utf-8"),
) as Record<string, { version: string; sha256: string; url: string; status: string }>;

const ВИДЫ = Object.keys(LEGAL_FILES) as LegalId[];

describe("чтение документов", () => {
  it.each(ВИДЫ)("%s: головной блок разобран", (вид) => {
    const документ = loadLegalDocument(вид);

    expect(документ.id).toBe(вид);
    expect(документ.title.length).toBeGreaterThan(5);
    expect(документ.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(документ.url).toBe(МАНИФЕСТ[вид]?.url);
    expect(документ.body.length).toBeGreaterThan(500);
    // Головной блок в текст не попадает: он метаданные, а не документ.
    expect(документ.body.startsWith("---")).toBe(false);
    expect(документ.body).not.toContain("effective_from:");
  });

  it.each(ВИДЫ)("%s: версия та же, что в манифесте и у браузера", (вид) => {
    const документ = loadLegalDocument(вид);

    expect(документ.version).toBe(МАНИФЕСТ[вид]?.version);
    expect(документ.version).toBe(LEGAL_VERSIONS[вид]);
  });

  it.each(ВИДЫ)("%s: хэш манифеста посчитан от этого текста", (вид) => {
    // Хэш считается от файла, а не от показанного: подстановки на
    // странице заменяются на видимые поля, и хэш от такого текста
    // ничего бы не подтверждал.
    const файл = readFileSync(`docs/legal/${LEGAL_FILES[вид]}`, "utf-8");
    const тело = файл.slice(файл.indexOf("\n---\n") + 5).trim();

    expect(createHash("sha256").update(тело, "utf-8").digest("hex")).toBe(
      МАНИФЕСТ[вид]?.sha256,
    );
  });

  it.each(ВИДЫ)("%s: незаполненные поля видны как поля", (вид) => {
    const документ = loadLegalDocument(вид);

    // Пока документ — проект, в нём остаются подстановки, и показывать их
    // надо так, чтобы никто не принял проект за действующий документ.
    if (МАНИФЕСТ[вид]?.status === "draft") {
      expect(документ.status).toBe("draft");
      expect(документ.body).not.toContain("{{");
    } else {
      expect(документ.body).not.toContain("[фио");
      expect(документ.effectiveFrom).not.toBeNull();
    }
  });

  it("подстановка превращается в видимое поле, а не в пустоту", () => {
    const соглашение = loadLegalDocument("terms");

    // Пустое место читалось бы опечаткой, а выдуманное значение — обещанием
    // за владельца.
    expect(соглашение.body).toContain("[фио оператора]");
    expect(соглашение.body).toContain("[почтовый адрес]");
  });

  it("у всех трёх документов свой адрес", () => {
    const адреса = ВИДЫ.map((вид) => loadLegalDocument(вид).url);

    expect(new Set(адреса).size).toBe(3);
    expect(адреса).toEqual(expect.arrayContaining(["/privacy", "/consent", "/terms"]));
  });
});
