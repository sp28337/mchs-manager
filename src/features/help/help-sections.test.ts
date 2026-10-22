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
      "Настройка графика",
      "График",
      "Производственный календарь",
      "События",
      "Статистика",
      "Управление графиками",
    ]);
  });

  it("у каждого свой адрес и свой значок", () => {
    expect(new Set(HELP_SECTION_IDS).size).toBe(HELP_SECTIONS.length);
    expect(new Set(HELP_SECTIONS.map((section) => section.icon)).size).toBe(HELP_SECTIONS.length);
  });

  it("пункты меню короткие: прежние длинные названия ушли", () => {
    const titles = HELP_SECTIONS.map((section) => section.title);
    expect(titles).not.toContain("Создание профиля");
    expect(titles).not.toContain("Графики");
    expect(Math.max(...titles.map((title) => title.length))).toBeLessThanOrEqual(26);
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
    it(`«${section.title}»: рисуется, строки с текстом и короткая стопка`, () => {
      act(() => root.render(createElement(HelpSection, { id: section.id })));

      expect(container.querySelector("p")?.textContent?.length).toBeGreaterThan(20);
      // Раньше разделов было восемь, а строк — под полсотни, и большинство из
      // них пересказывало то, что видно на экране. Предел — защита от возврата.
      expect(rows().length).toBeGreaterThanOrEqual(2);
      expect(rows().length).toBeLessThanOrEqual(5);
    });
  }

  it("всего строк вдвое-втрое меньше прежнего: не больше двадцати", () => {
    let total = 0;
    for (const section of HELP_SECTIONS) {
      act(() => root.render(createElement(HelpSection, { id: section.id })));
      total += rows().length;
    }
    expect(total).toBeLessThanOrEqual(20);
  });

  it("первый раздел — тремя строками с заголовками-задачами, а не описанием интерфейса", () => {
    act(() => root.render(createElement(HelpSection, { id: "create" })));

    expect(rows()).toEqual(["Как настроить график", "Добавление графика", "Изменение настроек"]);
    // Прежние канцелярские заголовки не вернулись.
    for (const old of ["Что спросит окно", "Потом поправить", "Откуда открыть", "Добавление нового графика"]) {
      expect(rows()).not.toContain(old);
    }
  });

  it("у каждой строки заголовок — задача: «Как …» или действие, а не часть экрана", () => {
    const heads: string[] = [];
    for (const section of HELP_SECTIONS) {
      act(() => root.render(createElement(HelpSection, { id: section.id })));
      heads.push(...rows().filter((it): it is string => it !== null && it !== undefined));
    }
    // Названий частей экрана, какими строки назывались раньше.
    for (const old of [
      "Итог над сеткой", "Учётный период", "Клетки", "Правка дня", "Знаки у нижней кромки",
      "Четыре вида дней", "Переносы и правки", "Лента", "Правка и возврат", "Чья статистика",
      "Что в ней", "Проводник", "Сохранить и перенести",
    ]) {
      expect(heads).not.toContain(old);
    }
    // Большинство начинается с «Как» — это то, что человек ищет.
    expect(heads.filter((it) => it.startsWith("Как ")).length).toBeGreaterThanOrEqual(heads.length - 4);
  });

  it("в «Добавлении графика» «Графики» → «График» и «Загрузить из файла» — со значками", () => {
    act(() => root.render(createElement(HelpSection, { id: "create" })));

    const withIcon = (label: string) => {
      const found = [...container.querySelectorAll("span")].find(
        (el) => el.textContent === `«${label}»` && el.querySelector("svg") !== null,
      );
      return found?.querySelector("svg") ?? null;
    };
    expect(withIcon("Графики")).not.toBeNull();
    expect(withIcon("График")).not.toBeNull();
    expect(withIcon("Загрузить из файла")).not.toBeNull();
    // Значок не озвучивается: слово рядом говорит то же.
    expect(withIcon("График")?.getAttribute("aria-hidden")).toBe("true");
    // «Построить график» — без значка: на главной у кнопки свой, и в тексте он не нужен.
    expect(
      [...container.querySelectorAll("span")].some(
        (el) => el.textContent === "«Построить график»" && el.querySelector("svg") !== null,
      ),
    ).toBe(false);
  });

  it("про события и папки при загрузке из файла справка не обещает: хвост убран", () => {
    act(() => root.render(createElement(HelpSection, { id: "create" })));

    expect(container.textContent).not.toContain("восстановятся");
    expect(container.textContent).toContain("«Загрузить из файла».");
  });

  it("раздел «График» начинается с выбора периода", () => {
    act(() => root.render(createElement(HelpSection, { id: "schedule" })));

    expect(rows()[0]).toBe("Как выбрать период");
    expect(rows()[1]).toBe("Как читать итог");
  });

  it("кнопки «Из файла» в проводнике справка не знает: файл загружают в окне создания", () => {
    for (const section of HELP_SECTIONS) {
      act(() => root.render(createElement(HelpSection, { id: section.id })));
      expect(container.textContent, section.title).not.toContain("«Из файла»");
    }
  });

  it("поле названо как на экране: «Начало отсчёта», а не «дата начала учёта»", () => {
    act(() => root.render(createElement(HelpSection, { id: "create" })));

    expect(container.textContent).toContain("«Начало отсчёта»");
    expect(container.textContent).not.toContain("начала учёта");
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
