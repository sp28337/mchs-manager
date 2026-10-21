/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Dec } from "../domain/decimal";
import { Ledger, signed, type LedgerColumn } from "./stats-ledger";

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

  it("итоговый столбец отбит чертой, месячные — нет", () => {
    render([column(), column({ key: "t", head: "Год", total: true })]);

    // Первый заголовок — пустая ячейка над названиями показателей.
    const [, plain, sum] = [...container.querySelectorAll('thead th[scope="col"]')];
    expect(plain?.className).not.toContain("border-l");
    expect(sum?.className).toContain("border-l");
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
