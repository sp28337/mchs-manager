/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExplorerDock, ExplorerRailKnobs } from "./explorer-dock";
import type { ExplorerTools } from "./profile-explorer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // Заглушки общие на весь файл: счётчик вызовов не должен тянуться из теста в тест.
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// Знакам нужны только два действия, остальное состояние — проводника; заглушки полные,
// чтобы тип сходился без приведения.
const tools: ExplorerTools = {
  newFolder: vi.fn(),
  newProfile: vi.fn(),
  addingFolder: false,
  closeFolderField: vi.fn(),
  creating: false,
  closeCreate: vi.fn(),
  folderId: "grafik13",
  openFolder: vi.fn(),
  error: null,
  say: vi.fn(),
};

const render = () => act(() => root.render(createElement(ExplorerDock, { tools })));

describe("знаки проводника", () => {
  it("два действия и тема — в одной правой группе, действий слева нет", () => {
    render();

    const dock = container.querySelector('[aria-label="Действия со списком графиков"]');
    // Один ребёнок у ряда: прежней левой группы больше нет.
    expect(dock?.children).toHaveLength(1);
    expect(dock?.firstElementChild?.className).toContain("md:ml-auto");

    expect([...container.querySelectorAll("button")].map((it) => it.getAttribute("aria-label"))).toEqual([
      "Создать папку",
      "Создать график",
      "Тема оформления",
    ]);
  });

  it("кнопки «Из файла» нет: файл загружают в окне создания графика", () => {
    render();

    const labels = [...container.querySelectorAll("button")].map((it) => it.getAttribute("aria-label") ?? "");
    expect(labels.some((label) => /файл/i.test(label))).toBe(false);
    expect(container.textContent).not.toContain("Из файла");
  });

  it("от темы действия отделены клеткой знака (44 точки), а в колонке «Папка» ниже всех", () => {
    render();

    const group = container.querySelector("button[aria-label='Создать папку']")?.closest("div.md\\:mb-11");
    expect(group).not.toBeNull();
    expect(group?.className).toContain("md:flex-col-reverse");
  });

  it("с lg действий у кромки нет — они в колонке под меню, а тема остаётся на месте", () => {
    render();

    const group = container.querySelector("button[aria-label='Создать график']")?.closest("div.md\\:mb-11");
    expect(group?.className).toContain("lg:hidden");
    // Тема — не в этой группе и не прячется.
    const theme = container.querySelector("button[aria-label='Тема оформления']");
    expect(theme?.closest("div.md\\:mb-11")).toBeNull();
  });

  it("подпись выезжает влево: стоит в кнопке перед значком", () => {
    render();

    const button = container.querySelector("button[aria-label='Создать график']")!;
    const [label, icon] = [...button.children];
    expect(label?.textContent).toBe("График");
    expect(icon?.querySelector("svg")).not.toBeNull();
  });

  it("нажатие вызывает своё действие", () => {
    render();

    act(() => container.querySelector<HTMLButtonElement>("button[aria-label='Создать график']")?.click());
    expect(tools.newProfile).toHaveBeenCalledOnce();
    expect(tools.newFolder).not.toHaveBeenCalled();
  });
});

describe("те же знаки в колонке под меню", () => {
  const renderRail = () => act(() => root.render(createElement(ExplorerRailKnobs, { tools })));

  it("«График», затем «Папка»: порядок сверху вниз тот же, что у кромки снизу вверх", () => {
    renderRail();

    expect([...container.querySelectorAll("button")].map((it) => it.getAttribute("aria-label"))).toEqual([
      "Создать график",
      "Создать папку",
    ]);
  });

  it("подпись короткая, а имя для программы чтения полное", () => {
    renderRail();

    const [graph, folder] = [...container.querySelectorAll("button")];
    expect(graph?.textContent).toBe("График");
    expect(folder?.textContent).toBe("Папка");
  });

  it("нажатия ведут к тем же действиям", () => {
    renderRail();

    act(() => container.querySelector<HTMLButtonElement>("button[aria-label='Создать папку']")?.click());
    expect(tools.newFolder).toHaveBeenCalledOnce();
    act(() => container.querySelector<HTMLButtonElement>("button[aria-label='Создать график']")?.click());
    expect(tools.newProfile).toHaveBeenCalledOnce();
  });
});
