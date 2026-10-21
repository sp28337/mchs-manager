/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FooterBody } from "./site-footer";

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

function render(skeleton = false) {
  act(() => root.render(createElement(FooterBody, { skeleton })));
}

const labels = () => [...container.querySelectorAll("h2")].map((it) => it.textContent);

describe("подвал", () => {
  it("три колонки: «О расчёте», «Документы», «Контакты» — без «Навигации»", () => {
    render();

    expect(labels()).toEqual(["О расчёте", "Документы", "Контакты"]);
    expect(container.textContent).not.toContain("Навигация");
  });

  it("справка — в «Документах», первой, и ведёт на /help", () => {
    render();

    const documents = container.querySelector('nav[aria-labelledby="footer-documents"]');
    const links = [...(documents?.querySelectorAll("a") ?? [])];

    expect(links.map((it) => it.textContent)).toEqual([
      "Справка",
      "Пользовательское соглашение",
      "Политика конфиденциальности",
      "Согласие на обработку данных",
      "Настройки cookie",
    ]);
    expect(links[0]?.getAttribute("href")).toBe("/help");
  });

  it("ссылок на разделы расчёта в подвале больше нет", () => {
    render();

    const hrefs = [...container.querySelectorAll("a")].map((it) => it.getAttribute("href"));
    expect(hrefs.filter((it) => it?.startsWith("/calculator"))).toEqual([]);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("заглушка — те же три колонки, а ссылок нет", () => {
    render(true);

    expect(labels()).toEqual(["О расчёте", "Документы", "Контакты"]);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});
