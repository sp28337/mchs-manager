import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LEGAL_URLS, LEGAL_VERSIONS, consentPayload } from "./legal";

/**
 * Версии в коде и в документах — одно и то же.
 *
 * Иначе сервер отвергнет регистрацию кодом `consent_required`, а человек
 * увидит отказ, причины которого в интерфейсе нет: документы он читал, с
 * чем согласился — непонятно. Тот же тест стоит на сервере
 * (`api/tests/test_legal.py`), и обе стороны сверяются с одними файлами.
 */
const ФАЙЛЫ = {
  policy: "docs/legal/privacy-policy.md",
  consent: "docs/legal/consent.md",
  terms: "docs/legal/terms.md",
} as const;

function головнойБлок(путь: string): Record<string, string> {
  const текст = readFileSync(путь, "utf-8");
  const блок = /^---\n([\s\S]*?)\n---/.exec(текст);

  expect(блок).not.toBeNull();

  const поля: Record<string, string> = {};

  for (const строка of (блок?.[1] ?? "").split("\n")) {
    const пара = /^(\w+):\s*(.*)$/.exec(строка);
    if (пара !== null) поля[пара[1] as string] = (пара[2] as string).replace(/^"|"$/g, "");
  }

  return поля;
}

describe("версии юридических документов", () => {
  for (const [id, путь] of Object.entries(ФАЙЛЫ)) {
    it(`${id}: версия совпадает с головным блоком`, () => {
      const блок = головнойБлок(путь);

      expect(блок.id).toBe(id);
      expect(блок.version).toBe(LEGAL_VERSIONS[id as keyof typeof LEGAL_VERSIONS]);
      expect(блок.url).toBe(LEGAL_URLS[id as keyof typeof LEGAL_URLS]);
    });
  }
});

describe("consentPayload", () => {
  it("уносит версии трёх документов и действия человека", () => {
    expect(consentPayload({ termsAndPolicy: true, personalData: true })).toEqual({
      policy_version: LEGAL_VERSIONS.policy,
      consent_version: LEGAL_VERSIONS.consent,
      terms_version: LEGAL_VERSIONS.terms,
      accepted_terms_and_policy: true,
      accepted_personal_data: true,
    });
  });

  it("признаки берутся из отметок, а не подставляются истиной", () => {
    // Иначе нажатая без отметки кнопка записала бы согласие, которого не было.
    const payload = consentPayload({ termsAndPolicy: true, personalData: false });

    expect(payload.accepted_terms_and_policy).toBe(true);
    expect(payload.accepted_personal_data).toBe(false);
  });

  it("без согласия на аналитику: оно к учётной записи не относится", () => {
    expect(Object.keys(consentPayload({ termsAndPolicy: true, personalData: true }))).not.toContain(
      "cookies_version",
    );
  });
});
