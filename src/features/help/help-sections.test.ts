/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HELP_SECTIONS, HELP_SECTION_IDS, HelpSection } from "./help-sections";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("разделы справки", () => {
  it("шесть главных разделов — в том порядке и под теми названиями, что названы", () => {
    expect(HELP_SECTIONS.map((section) => section.title)).toEqual([
      "Создание профиля",
      "График",
      "Производственный календарь",
      "События",
      "Статистика",
      "Графики",
    ]);
  });

  it("у каждого свой адрес и свой значок", () => {
    expect(new Set(HELP_SECTION_IDS).size).toBe(HELP_SECTIONS.length);
    expect(new Set(HELP_SECTIONS.map((section) => section.icon)).size).toBe(HELP_SECTIONS.length);
  });

  it("прежних разделов нет: справка не разрослась обратно", () => {
    const ids: string[] = [...HELP_SECTION_IDS];
    for (const old of ["start", "header", "totals", "cells", "edit", "dock", "data"]) {
      expect(ids).not.toContain(old);
    }
  });
});

describe("содержимое разделов", () => {
  /** Строки справки — это заголовки третьего уровня: по строке на тему. */
  const rows = () => [...container.querySelectorAll("h3")].map((it) => it.textContent);

  for (const section of HELP_SECTIONS) {
    it(`«${section.title}»: рисуется, с вводной и короткой стопкой строк`, () => {
      act(() => root.render(createElement(HelpSection, { id: section.id })));

      expect(container.querySelector("p")?.textContent?.length).toBeGreaterThan(20);
      // Раньше разделов было восемь, а строк — под полсотни, и большинство из
      // них пересказывало то, что видно на экране. Предел — защита от возврата.
      expect(rows().length).toBeGreaterThanOrEqual(2);
      expect(rows().length).toBeLessThanOrEqual(5);
    });
  }

  it("всего строк вдвое-втрое меньше прежнего: меньше двадцати", () => {
    let total = 0;
    for (const section of HELP_SECTIONS) {
      act(() => root.render(createElement(HelpSection, { id: section.id })));
      total += rows().length;
    }
    expect(total).toBeLessThan(20);
  });

  it("добавление графика названо так, а кнопки «Из файла» в проводнике справка не знает", () => {
    act(() => root.render(createElement(HelpSection, { id: "create" })));
    expect(rows()).toContain("Добавление нового графика");
    expect(rows()).not.toContain("Откуда открыть");

    // Кнопки «Из файла» в «Графиках» больше нет — файл загружают в окне
    // создания графика, и ни один раздел не должен отсылать к прежней.
    for (const section of HELP_SECTIONS) {
      act(() => root.render(createElement(HelpSection, { id: section.id })));
      expect(container.textContent, section.title).not.toContain("«Из файла»");
    }
  });

  it("слова из справки находятся на экране буквально: названия кнопок в кавычках", () => {
    act(() => root.render(createElement(HelpSection, { id: "create" })));
    expect(container.textContent).toContain("«Построить график»");
    expect(container.textContent).toContain("«Загрузить из файла»");

    act(() => root.render(createElement(HelpSection, { id: "events" })));
    expect(container.textContent).toContain("«Вернуть»");
    expect(container.textContent).toContain("«Сбросить календарь»");
  });

  it("то, что событие делает с расчётом, взято из словаря приложения, а не пересказано", () => {
    act(() => root.render(createElement(HelpSection, { id: "events" })));

    const text = container.textContent ?? "";
    expect(text).toContain("часы по норме за эти дни исключаются из нормы");
    expect(text).toContain("отгул и есть её погашение");
    expect(text).toContain("дни поездки идут по среднему заработку");
  });

  it("виды дней календаря — все четыре, с тем, что они делают с нормой", () => {
    act(() => root.render(createElement(HelpSection, { id: "calendar" })));

    const text = container.textContent ?? "";
    for (const word of ["Рабочий", "Предпраздничный", "Праздничный", "Выходной"]) {
      expect(text).toContain(word);
    }
    expect(text).toContain("ст. 95 ТК РФ");
    expect(text).toContain("ст. 112 ТК РФ");
  });
});
