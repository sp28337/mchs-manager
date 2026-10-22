/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./confirm-dialog";

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

type Extra = Partial<Parameters<typeof ConfirmDialog>[0]>;

const render = (children?: string, extra: Extra = {}) =>
  act(() =>
    root.render(
      createElement(
        ConfirmDialog,
        {
          open: false,
          onClose: () => undefined,
          onConfirm: () => undefined,
          title: "Выйти из аккаунта?",
          confirm: "Выйти",
          ...extra,
        },
        children,
      ),
    ),
  );

const buttons = () => [...container.querySelectorAll("footer button")];
const body = () => container.querySelector("[data-modal-body] .space-y-2.text-sm");

describe("окно «точно?»", () => {
  it("без текста — только заголовок и две кнопки, пустого блока под вопросом нет", () => {
    render();

    expect(container.querySelector("h2")?.textContent).toBe("Выйти из аккаунта?");
    expect(buttons().map((it) => it.textContent?.trim())).toEqual(["Отмена", "Выйти"]);
    expect(body()).toBeNull();
  });

  it("с текстом он стоит над кнопками", () => {
    render("Что произойдёт");

    expect(body()?.textContent).toBe("Что произойдёт");
    expect(container.querySelector("[data-modal-body]")?.nextElementSibling?.tagName).toBe("FOOTER");
  });

  it("слева от заголовка плитка со знаком: у окна вопроса она всегда есть", () => {
    render();

    const tile = container.querySelector("header [aria-hidden='true']");
    expect(tile?.querySelector("svg")).not.toBeNull();
    expect(tile?.className).toContain("border-rule");
  });

  it("стирающее окно красное: плитка, кнопка, а фокус — на «Отмене»", () => {
    render("Данные пропадут", { destructive: true, confirm: "Удалить" });

    expect(container.querySelector("header [aria-hidden='true']")?.className).toContain("border-signal");
    const [cancel, confirm] = buttons();
    expect(confirm?.className).toContain("bg-signal");
    expect(cancel?.hasAttribute("data-autofocus")).toBe(true);
    expect(confirm?.hasAttribute("data-autofocus")).toBe(false);
  });

  it("обычное окно: фокус на согласии, кнопка не красная", () => {
    render();

    const [cancel, confirm] = buttons();
    expect(confirm?.className).toContain("bg-ink");
    expect(confirm?.className).not.toContain("bg-signal");
    expect(confirm?.hasAttribute("data-autofocus")).toBe(true);
    expect(cancel?.hasAttribute("data-autofocus")).toBe(false);
  });

  it("тон можно назвать: зелёное окно не красится красным, хотя и не «стирает»", () => {
    render(undefined, { tone: "verify" });

    expect(container.querySelector("header [aria-hidden='true']")?.className).toContain("border-verify");
    expect(buttons()[1]?.className).toContain("bg-ink");
  });

  it("строка под заголовком и предмет вопроса стоят на своих местах", () => {
    render("Текст", { lead: "Чем это кончится", subject: "Имя графика" });

    expect(container.querySelector("header p")?.textContent).toBe("Чем это кончится");
    const well = container.querySelector("[data-modal-body] .bg-paper");
    expect(well?.textContent).toBe("Имя графика");
    // Предмет — над пояснением, а не под ним.
    expect(well?.nextElementSibling?.textContent).toBe("Текст");
  });

  it("свой отказ называется своим словом и запускает своё действие", () => {
    const decline = vi.fn();
    render(undefined, { decline: { label: "Открыть без сохранения", onClick: decline } });

    const [second] = buttons();
    expect(second?.textContent).toBe("Открыть без сохранения");
    act(() => (second as HTMLElement).click());
    expect(decline).toHaveBeenCalledTimes(1);
  });
});
