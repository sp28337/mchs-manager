/** @vitest-environment jsdom */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Materialize } from "./materialize";

const html = (props: Partial<Parameters<typeof Materialize>[0]>) =>
  renderToStaticMarkup(
    createElement(Materialize, { show: true, ...props } as Parameters<typeof Materialize>[0], "слово"),
  );

describe("проступание слова", () => {
  it("по умолчанию — с расфокусировкой: переход идёт и по прозрачности, и по резкости", () => {
    expect(html({ show: false })).toContain("blur-[6px]");
    expect(html({ show: false })).toContain("transition-[opacity,filter]");
    expect(html({ show: true })).toContain("blur-none");
  });

  it("без расфокусировки остаётся одна прозрачность — ни следа размытия в классах", () => {
    for (const show of [true, false]) {
      const markup = html({ show, blur: false });

      expect(markup).not.toContain("blur");
      expect(markup).not.toContain("filter");
      expect(markup).toContain("transition-opacity");
      expect(markup).toContain(show ? "opacity-100" : "opacity-0");
    }
  });

  it("свой уровень размытия работает, пока оно включено, и игнорируется, когда выключено", () => {
    expect(html({ show: false, blurClassName: "blur-sm" })).toContain("blur-sm");
    expect(html({ show: false, blurClassName: "blur-sm", blur: false })).not.toContain("blur-sm");
  });
});
