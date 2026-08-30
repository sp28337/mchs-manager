import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PAPER } from "./window-top";

/**
 * Цвет верха окна обязан совпадать с цветом бумаги.
 *
 * Он не читается из стилей, и на то есть причина (она в самом компоненте:
 * вебкит отдавал старое значение, и полоса отставала на шаг). Плата за это
 * — два цвета, записанные дважды: здесь и в `globals.css`. Расхождение
 * получится незаметным глазу в разработке и заметным на телефоне, где
 * полоса займёт четверть экрана чужим цветом.
 *
 * Поэтому проверка читает саму таблицу стилей и сверяет обе темы. Это
 * единственное, что мешает им разъехаться.
 */
const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

/**
 * Достаёт `--fps-paper` из объявления темы — светлой (`:root`) или тёмной.
 *
 * Блоков с одним и тем же именем в файле несколько: у `:root` их два, и
 * первый занят безопасными зонами телефона, а не палитрой. Поэтому берётся
 * не первый попавшийся, а тот, где бумага объявлена.
 */
function paperOf(selector: string): string {
  const blocks = [...css.matchAll(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, "g"))];
  expect(blocks.length, `в globals.css не нашёлся блок ${selector}`).toBeGreaterThan(0);

  for (const block of blocks) {
    const paper = /--fps-paper:\s*(#[0-9a-fA-F]{3,8});/.exec(block[1]!);
    if (paper) return paper[1]!.toLowerCase();
  }

  throw new Error(`ни в одном блоке ${selector} нет --fps-paper`);
}

/** `#fff` и `#ffffff` — один цвет; сравнивать их как строки нельзя. */
function expand(hex: string): string {
  return hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
}

describe("цвет полосы браузера", () => {
  it("на светлой теме — это бумага из :root", () => {
    expect(PAPER.light).toBe(expand(paperOf(":root")));
  });

  it("на тёмной теме — это бумага из .dark", () => {
    expect(PAPER.dark).toBe(expand(paperOf("\\.dark")));
  });
});
