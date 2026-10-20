import { describe, expect, it } from "vitest";

import { changeSchema, diffDocuments, diffWords, toParts } from "./diff";

describe("toParts", () => {
  it("склеивает строки абзаца и снимает разметку", () => {
    const parts = toParts(
      "Первая **строка**\nвторая [ссылка](/privacy) и `код`.\n\nДругой абзац.",
    );

    expect(parts).toEqual([
      { text: "Первая строка вторая ссылка и код.", heading: false },
      { text: "Другой абзац.", heading: false },
    ]);
  });

  it("заголовок — отдельная часть, пункт списка — тоже, продолжение прилипает", () => {
    const parts = toParts("## Сроки\n\n* первый пункт\n  продолжается\n* второй\n");

    expect(parts).toEqual([
      { text: "Сроки", heading: true },
      { text: "• первый пункт продолжается", heading: false },
      { text: "• второй", heading: false },
    ]);
  });

  it("строки таблицы — по части, разделитель шапки пропускается", () => {
    const parts = toParts("| Данные | Срок |\n|---|---|\n| адрес | 30 дней |\n");

    expect(parts).toEqual([
      { text: "Данные · Срок", heading: false },
      { text: "адрес · 30 дней", heading: false },
    ]);
  });

  it("цитата читается как обычный абзац", () => {
    expect(toParts("> Даю согласие")).toEqual([{ text: "Даю согласие", heading: false }]);
  });
});

describe("diffWords", () => {
  it("одно слово сменилось — убрано старое, добавлено новое", () => {
    expect(diffWords("срок 30 дней", "срок 10 дней")).toEqual([
      { op: "same", text: "срок " },
      { op: "del", text: "30" },
      { op: "add", text: "10" },
      { op: "same", text: " дней" },
    ]);
  });

  it("пробел между правками не остаётся «неизменным»: правка собирается целиком", () => {
    const tokens = diffWords("из а б в", "из х у в");

    expect(tokens).toEqual([
      { op: "same", text: "из " },
      { op: "del", text: "а б" },
      { op: "add", text: "х у" },
      { op: "same", text: " в" },
    ]);
  });

  it("совпадающий текст — одна неизменная часть", () => {
    expect(diffWords("то же самое", "то же самое")).toEqual([
      { op: "same", text: "то же самое" },
    ]);
  });

  it("убранное и добавленное по краям", () => {
    expect(diffWords("база данных", "новая база данных на сервере")).toEqual([
      { op: "add", text: "новая " },
      { op: "same", text: "база данных" },
      { op: "add", text: " на сервере" },
    ]);
  });

  it("склеив «было» и «стало» обратно, получаем исходные строки", () => {
    const before = "Оператор вправе поручить обработку хостинг-провайдеру, всё остальное — нет.";
    const after = "Оператор поручает обработку хостинг-провайдеру {{X}}, остальное не поручается.";
    const tokens = diffWords(before, after);

    expect(tokens.filter((t) => t.op !== "add").map((t) => t.text).join("")).toBe(before);
    expect(tokens.filter((t) => t.op !== "del").map((t) => t.text).join("")).toBe(after);
  });
});

const СТАРОЕ = `## Передача

Данные никому не передаются.

## Сроки

Хранится 30 дней.

## Контакты

Пишите на почту.
`;

describe("diffDocuments", () => {
  it("без изменений: показывать нечего, всё посчитано", () => {
    const change = diffDocuments(СТАРОЕ, СТАРОЕ, "2026-01-01", "2026-02-02");

    expect(change.blocks).toEqual([]);
    expect(change.unchanged).toBe(3);
    expect(change.from).toBe("2026-01-01");
    expect(change.to).toBe("2026-02-02");
  });

  it("переписанный абзац — правка слов, перед ней заголовок раздела", () => {
    const новое = СТАРОЕ.replace("Хранится 30 дней.", "Хранится 10 дней.");
    const change = diffDocuments(СТАРОЕ, новое, "a", "b");

    expect(change.blocks).toHaveLength(2);
    expect(change.blocks[0]).toEqual({ kind: "heading", text: "Сроки" });
    expect(change.blocks[1]).toMatchObject({ kind: "changed", heading: false });
    expect(change.unchanged).toBe(2);
  });

  it("новый абзац — «добавлен», убранный — «убран»", () => {
    const новое = СТАРОЕ.replace("Пишите на почту.", "Пишите на почту или в письменной форме.\n\nОтвет в течение десяти рабочих дней.").replace(
      "Данные никому не передаются.\n\n",
      "",
    );
    const change = diffDocuments(СТАРОЕ, новое, "a", "b");
    const kinds = change.blocks.map((b) => b.kind);

    expect(kinds).toContain("removed");
    expect(kinds).toContain("added");
    expect(kinds).toContain("changed");
  });

  it("новый раздел показывается заголовком-добавлением, без лишнего «раздела»", () => {
    const новое = `${СТАРОЕ}\n## Отзыв\n\nОтзыв — удаление учётной записи.\n`;
    const change = diffDocuments(СТАРОЕ, новое, "a", "b");

    expect(change.blocks).toEqual([
      { kind: "added", text: "Отзыв", heading: true },
      { kind: "added", text: "Отзыв — удаление учётной записи.", heading: false },
    ]);
  });

  it("убранный абзац показывается в своём разделе", () => {
    const новое = СТАРОЕ.replace("Данные никому не передаются.\n\n", "");
    const change = diffDocuments(СТАРОЕ, новое, "a", "b");

    expect(change.blocks).toEqual([
      { kind: "heading", text: "Передача" },
      { kind: "removed", text: "Данные никому не передаются.", heading: false },
    ]);
  });

  it("результат укладывается в форму, которую разбирает браузер", () => {
    const новое = СТАРОЕ.replace("30 дней", "10 дней");

    expect(() => changeSchema.parse(diffDocuments(СТАРОЕ, новое, "a", "b"))).not.toThrow();
  });
});
