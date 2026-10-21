/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExplorerDock } from "./explorer-dock";
import type { ExplorerTools } from "./profile-explorer";

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

// Знакам нужны только три действия, остальное состояние — проводника; заглушки полные,
// чтобы тип сходился без приведения.
const tools: ExplorerTools = {
  newFolder: vi.fn(),
  newProfile: vi.fn(),
  importFile: vi.fn(),
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
  it("три действия и тема — в одной правой группе, действий слева нет", () => {
    render();

    const dock = container.querySelector('[aria-label="Действия со списком графиков"]');
    // Один ребёнок у ряда: прежней левой группы больше нет.
    expect(dock?.children).toHaveLength(1);
    expect(dock?.firstElementChild?.className).toContain("md:ml-auto");

    expect([...container.querySelectorAll("button")].map((it) => it.getAttribute("aria-label"))).toEqual([
      "Создать папку",
      "Создать график",
      "Загрузить график из файла",
      "Тема оформления",
    ]);
  });

  it("от темы действия отделены клеткой знака (44 точки), а в колонке «Папка» ниже всех", () => {
    render();

    const group = container.querySelector("button[aria-label='Создать папку']")?.closest("div.md\\:mb-11");
    expect(group).not.toBeNull();
    expect(group?.className).toContain("md:flex-col-reverse");
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

    act(() => container.querySelector<HTMLButtonElement>("button[aria-label='Загрузить график из файла']")?.click());
    expect(tools.importFile).toHaveBeenCalledOnce();
    expect(tools.newFolder).not.toHaveBeenCalled();
  });
});
