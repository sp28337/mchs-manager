/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Modal } from "./modal";

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

type Props = Partial<Omit<Parameters<typeof Modal>[0], "children">>;

// Тело окна — третьим аргументом, как велит правило React; тип же требует
// `children` среди свойств, поэтому свойства приводятся к типу окна целиком.
const render = (props: Props = {}) =>
  act(() =>
    root.render(
      createElement(
        Modal,
        {
          open: false,
          onClose: () => undefined,
          title: "Заголовок",
          ...props,
        } as Parameters<typeof Modal>[0],
        createElement("p", null, "Тело"),
      ),
    ),
  );

describe("анатомия окна", () => {
  it("без знака окно прежнее: заголовок и тело, ни плитки, ни подписи, ни полосы", () => {
    render({ lead: "Эта строка не рисуется без знака", footer: createElement("button", null, "Кнопка") });

    expect(container.querySelector("header > span[aria-hidden]")).toBeNull();
    expect(container.querySelector("header p")).toBeNull();
    // Полоса — отдельное свойство, и она есть и у окна без плитки.
    expect(container.querySelector("footer")?.textContent).toBe("Кнопка");
  });

  it("со знаком: плитка слева от заголовка, подпись под ним, полоса — после тела", () => {
    render({
      icon: createElement("svg", { "data-icon": "x" }),
      tone: "signal",
      lead: "Чем кончится",
      footer: createElement("button", null, "Стереть"),
    });

    const header = container.querySelector("header")!;
    const tile = header.firstElementChild!;
    expect(tile.getAttribute("aria-hidden")).toBe("true");
    expect(tile.querySelector("[data-icon]")).not.toBeNull();
    expect(tile.className).toContain("border-signal");
    expect(header.querySelector("h2")?.textContent).toBe("Заголовок");
    expect(header.querySelector("p")?.textContent).toBe("Чем кончится");
    // Налёт цвета смысла — на шапке; у серого его нет.
    expect(header.className).toContain("from-signal");

    const body = container.querySelector("[data-modal-body]")!;
    expect(body.textContent).toBe("Тело");
    expect(body.nextElementSibling?.tagName).toBe("FOOTER");
  });

  it("лист на весь экран держит свою шапку: знак у него не рисуется", () => {
    render({ icon: createElement("svg"), lead: "Нет", sheet: true });

    expect(container.querySelector("header > span[aria-hidden]")).toBeNull();
    expect(container.querySelector("header p")).toBeNull();
  });

  it("серое окно без налёта на шапке", () => {
    render({ icon: createElement("svg") });

    const header = container.querySelector("header")!;
    expect(header.className).not.toContain("from-");
    expect(header.firstElementChild?.className).toContain("border-rule");
  });

  it("имя окна для экранного диктора — его заголовок", () => {
    render({ icon: createElement("svg"), lead: "Подпись" });

    const dialog = container.querySelector("dialog")!;
    const heading = container.querySelector("h2")!;
    expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id);
  });
});
