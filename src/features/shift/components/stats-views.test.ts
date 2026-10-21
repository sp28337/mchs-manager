/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Dec } from "../domain/decimal";
import type { IsoDate } from "../domain/plain-date";
import { Ledger, signed, type LedgerColumn } from "./stats-ledger";
import { PeriodTimeline } from "./stats-timeline";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const day = (iso: string) => iso as IsoDate;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const column = (over: Partial<LedgerColumn> = {}): LedgerColumn => ({
  key: "1",
  head: "янв",
  full: "Январь",
  norm: Dec("120"),
  actual: Dec("192"),
  balance: 72,
  night: Dec("64"),
  holiday: Dec("48"),
  shifts: 8,
  ...over,
});

describe("таблица чисел: месяцы столбцами", () => {
  function render(columns: LedgerColumn[]) {
    act(() => root.render(createElement(Ledger, { caption: "Подпись таблицы", columns })));
  }

  it("настоящая таблица: подпись, заголовки столбцов и заголовки строк", () => {
    render([column(), column({ key: "2", head: "фев", full: "Февраль" })]);

    expect(container.querySelector("table caption")?.textContent).toBe("Подпись таблицы");
    // Пустая ячейка шапки названа для программы чтения.
    expect(container.querySelector("thead th .sr-only")?.textContent).toBe("Показатель");
    expect(container.querySelectorAll('thead th[scope="col"]')).toHaveLength(3);
    expect([...container.querySelectorAll('tbody th[scope="row"]')].map((it) => it.textContent)).toEqual(
      ["Норма, ч", "Факт, ч", "Баланс, ч", "Ночные, ч", "Праздничные, ч", "Смены"],
    );
  });

  it("баланс со знаком и типографским минусом, а цвет — лишь вторым признаком", () => {
    render([column({ balance: 72 }), column({ key: "2", balance: -11 }), column({ key: "3", balance: 0 })]);

    const cells = [...container.querySelectorAll("tbody tr:nth-child(3) td")];
    expect(cells.map((it) => it.textContent)).toEqual(["+72", "−11", "0"]);
    expect(cells[0]?.className).toContain("text-verify");
    expect(cells[1]?.className).toContain("text-signal");
    expect(cells[2]?.className).not.toMatch(/text-(verify|signal)/);
  });

  it("итоговый столбец отбит чертой, полугодие — тоже", () => {
    render([column(), column({ key: "t", head: "Год", total: true }), column({ key: "h", split: true })]);

    // Первый заголовок — пустая ячейка над названиями показателей.
    const [, plain, sum, half] = [...container.querySelectorAll('thead th[scope="col"]')];
    expect(plain?.className).not.toContain("border-l");
    expect(sum?.className).toContain("border-l");
    expect(half?.className).toContain("border-l");
  });

  it("часы без хвостовых нулей: 1621, а не 1621,0", () => {
    render([column({ norm: Dec("1621"), actual: Dec("1904.5") })]);

    const rows = [...container.querySelectorAll("tbody tr")].map((row) => row.lastElementChild?.textContent);
    expect(rows[0]).toBe("1621");
    expect(rows[1]).toMatch(/^1904[,.]5$/);
  });

  it("signed: нуль без знака, плюс и минус у остальных", () => {
    expect(signed(0)).toBe("0");
    expect(signed(24)).toBe("+24");
    expect(signed(-16)).toBe("−16");
  });
});

describe("лента периода", () => {
  const rows = [
    {
      key: "leave",
      label: "Отпуска",
      spans: [
        { key: "a", from: day("2026-07-06"), to: day("2026-07-26"), tone: "x", title: "Отпуск, 6 июля — 26 июля" },
        // Целиком вне ленты второго квартала: рисовать нечего.
        { key: "b", from: day("2026-01-10"), to: day("2026-01-12"), tone: "x", title: "вне" },
      ],
    },
    { key: "sick", label: "Больничные", spans: [] },
  ];

  function render(months: number[], today: string) {
    act(() =>
      root.render(createElement(PeriodTimeline, { year: 2026, months, rows, today: day(today) })),
    );
  }

  it("для программы чтения её нет: те же события читаются перечнем под ней", () => {
    render(Array.from({ length: 12 }, (_, month) => month), "2026-10-21");

    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("в году рисуются оба отрезка, во втором квартале — только вошедший", () => {
    render(Array.from({ length: 12 }, (_, month) => month), "2026-10-21");
    expect(container.querySelectorAll("[title]")).toHaveLength(2);

    render([6, 7, 8], "2026-08-10");
    expect(container.querySelectorAll("[title]")).toHaveLength(1);
    expect(container.querySelector("[title]")?.getAttribute("title")).toBe("Отпуск, 6 июля — 26 июля");
  });

  it("красная черта «сегодня» есть, только пока сегодня внутри периода", () => {
    const today = () => container.querySelectorAll(".bg-signal");

    render(Array.from({ length: 12 }, (_, month) => month), "2026-10-21");
    expect(today()).toHaveLength(1);

    render([0, 1, 2], "2026-10-21");
    expect(today()).toHaveLength(0);
  });

  it("месяцы подписаны по порядку периода", () => {
    render([3, 4, 5], "2026-05-01");

    const labels = [...container.querySelectorAll("span.text-ink-faint")].map((it) => it.textContent);
    expect(labels).toEqual(["апр", "май", "июн"]);
  });
});
