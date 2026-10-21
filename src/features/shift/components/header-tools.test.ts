/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RailKnob } from "@/components/shared/header-rail";
import { Settings } from "lucide-react";

import {
  AccountMenuItems,
  AccountRail,
  WorkspaceMenuItems,
  WorkspaceRail,
} from "./header-tools";

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

const render = (node: Parameters<Root["render"]>[0]) => act(() => root.render(node));

const noop = () => undefined;
const handlers = {
  onToggleSettings: noop,
  onToggleEvents: noop,
  onToggleStats: noop,
  onToggleExplorer: noop,
  onSave: noop,
};

const FIVE = ["Настройки", "События", "Статистика", "Графики", "Сохранить"];

/**
 * Пять действий стоят в двух местах: строками меню и знаками колонки под ним.
 * Они не должны дублировать друг друга — со строк с `lg` убирается всё, что
 * стоит знаком, а справка и учётная запись остаются.
 */
describe("меню и колонка знаков под ним", () => {
  const menuRows = () => [...container.querySelectorAll("button, a")];
  const text = (el: Element) => el.textContent?.trim();

  it("рабочий экран: пять строк меню скрыты с lg, справка остаётся", () => {
    render(createElement(WorkspaceMenuItems, handlers));

    const rows = menuRows();
    const hidden = rows.filter((it) => it.className.includes("lg:hidden")).map(text);
    expect(hidden).toEqual(FIVE);
    expect(rows.filter((it) => !it.className.includes("lg:hidden")).map(text)).toEqual(["Справка"]);
  });

  it("страница записи: пять строк-ссылок скрыты с lg, «Открыть график» и справка остаются", () => {
    render(createElement(AccountMenuItems));

    const rows = menuRows();
    expect(rows.filter((it) => it.className.includes("lg:hidden")).map(text)).toEqual(FIVE);
    expect(rows.filter((it) => !it.className.includes("lg:hidden")).map(text)).toEqual([
      "Открыть график",
      "Справка",
    ]);
  });

  it("колонка рабочего экрана — те же пять действий, в том же порядке", () => {
    render(createElement(WorkspaceRail, handlers));

    expect([...container.querySelectorAll("button")].map((it) => it.getAttribute("aria-label"))).toEqual(FIVE);
  });

  it("колонка страницы записи — ссылки на расчёт с адресом раздела", () => {
    render(createElement(AccountRail));

    const links = [...container.querySelectorAll("a")];
    expect(links.map((it) => it.getAttribute("aria-label"))).toEqual(FIVE);
    expect(links.map((it) => it.getAttribute("href"))).toEqual([
      "/calculator#settings",
      "/calculator#events",
      "/calculator#stats",
      "/calculator#graphs",
      "/calculator#save",
    ]);
  });

  it("горит знак открытого раздела, а «Сохранить» нажатым не бывает вовсе", () => {
    render(createElement(WorkspaceRail, { ...handlers, opened: "stats" }));

    const pressed = Object.fromEntries(
      [...container.querySelectorAll("button")].map((it) => [
        it.getAttribute("aria-label"),
        it.getAttribute("aria-pressed"),
      ]),
    );
    expect(pressed).toEqual({
      Настройки: "false",
      События: "false",
      Статистика: "true",
      Графики: "false",
      Сохранить: null,
    });
  });

  it("нажатие по знаку вызывает своё действие", () => {
    const calls: string[] = [];
    render(
      createElement(WorkspaceRail, {
        ...handlers,
        onToggleStats: () => calls.push("stats"),
        onSave: () => calls.push("save"),
      }),
    );

    act(() => {
      for (const label of ["Статистика", "Сохранить"]) {
        container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
      }
    });
    expect(calls).toEqual(["stats", "save"]);
  });
});

describe("знак колонки", () => {
  it("горящий красится чернилами, остальные — пустым цветом знаков", () => {
    const click = vi.fn();
    render(
      createElement("div", null, [
        createElement(RailKnob, { key: "a", icon: Settings, label: "Один", active: true, onClick: click }),
        createElement(RailKnob, { key: "b", icon: Settings, label: "Два", active: false, onClick: click }),
      ]),
    );

    const icon = (label: string) =>
      container.querySelector(`[aria-label="${label}"] span.grid.size-11`)?.className ?? "";
    expect(icon("Один")).toContain("dark:text-ink");
    expect(icon("Один")).not.toContain("opacity-24");
    expect(icon("Два")).toContain("opacity-24");
  });
});
