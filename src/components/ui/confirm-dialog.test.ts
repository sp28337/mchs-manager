/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

const render = (children?: string) =>
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
        },
        children,
      ),
    ),
  );

describe("окно «точно?»", () => {
  it("без текста — только заголовок и две кнопки, пустого блока под вопросом нет", () => {
    render();

    expect(container.querySelector("h2")?.textContent).toBe("Выйти из аккаунта?");
    expect([...container.querySelectorAll("button")].map((it) => it.textContent?.trim())).toContain("Выйти");
    expect(container.querySelector(".py-1.text-sm")).toBeNull();
  });

  it("с текстом он стоит над кнопками", () => {
    render("Что произойдёт");

    expect(container.querySelector(".py-1.text-sm")?.textContent).toBe("Что произойдёт");
  });
});
