/**
 * Юридические документы: текст берётся из `docs/legal/*.md`.
 *
 * Второй копии в коде нет намеренно. Сервер хранит у согласия версию
 * документа и отдаёт `sha256` его текста (`GET /legal/documents`), и
 * доказуемость «с чем именно человек согласился» держится на том, что
 * текст один: тот, что человек прочитал на странице, тот, что лежит в
 * архиве редакций, и тот, от которого посчитан хэш.
 *
 * --- Почему чтение файла, а не ввоз строки ---------------------------------
 *
 * Страницы собираются на сборке: сайт выгружается в статику, и к
 * браузеру уходит готовая разметка — ни файлов, ни разборщика Markdown в
 * ней нет. Поэтому модуль серверный: он читает файл с диска прямо во
 * время `next build`.
 *
 * --- Что происходит с подстановками ----------------------------------------
 *
 * В черновиках вместо имени и адреса владельца стоят `{{ФИО_ОПЕРАТОРА}}`
 * и `{{ПОЧТОВЫЙ_АДРЕС}}`: публичный репозиторий — не место для адреса
 * физического лица, заполняются они при публикации (шаг 15 плана,
 * чек-лист в `docs/legal/README.md`). До тех пор страница показывает их
 * угловыми скобками — как незаполненное поле, чем они и являются, — и
 * сверху стоит оговорка, что это проект документа.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Документы, у которых есть адрес на сайте. Карта данных внутренняя. */
export const LEGAL_FILES = {
  policy: "privacy-policy.md",
  consent: "consent.md",
  terms: "terms.md",
  cookies: "cookies.md",
} as const;

export type LegalId = keyof typeof LEGAL_FILES;

export interface LegalDocument {
  id: LegalId;
  title: string;
  /** Дата редакции — она же версия в записи о согласии. */
  version: string;
  /** Дата вступления в силу или `null`, пока документ не опубликован. */
  effectiveFrom: string | null;
  status: "draft" | "published";
  url: string;
  /** Текст без головного блока, с подстановками, готовыми к показу. */
  body: string;
}

/**
 * Прочитать документ.
 *
 * Зовётся из серверных компонентов страниц на сборке. Ошибка здесь валит
 * сборку, и это правильно: страница политики, собравшаяся без текста, —
 * хуже отсутствующей.
 */
export function loadLegalDocument(id: LegalId): LegalDocument {
  const файл = path.join(process.cwd(), "docs", "legal", LEGAL_FILES[id]);
  const текст = readFileSync(файл, "utf-8");
  const блок = /^---\n([\s\S]*?)\n---\n?/.exec(текст);

  if (блок === null) {
    throw new Error(`${LEGAL_FILES[id]}: нет головного блока`);
  }

  const поля = разобратьБлок(блок[1] as string);
  const status = поля.status === "published" ? "published" : "draft";

  if (поля.id !== id) {
    throw new Error(`${LEGAL_FILES[id]}: id «${поля.id ?? "нет"}», ожидался «${id}»`);
  }

  const тело = текст.slice(блок[0].length).trim();

  // То же, что проверяет `scripts/legal.mjs`, но на сборке сайта: страница
  // с `{{ФИО_ОПЕРАТОРА}}` под видом действующего документа не должна
  // собраться вовсе.
  if (status === "published" && тело.includes("{{")) {
    throw new Error(
      `${LEGAL_FILES[id]}: документ опубликован, а подстановки не заполнены`,
    );
  }

  return {
    id,
    title: поля.title ?? id,
    version: поля.version ?? "",
    effectiveFrom: поля.effective_from ?? null,
    status,
    url: поля.url ?? `/${id}`,
    body: показатьПодстановки(тело),
  };
}

/** Папка архива редакций одного документа: `docs/legal/archive/<id>/`. */
function archiveDir(id: LegalId): string {
  return path.join(process.cwd(), "docs", "legal", "archive", id);
}

/**
 * Какие прошлые редакции документа лежат в архиве.
 *
 * Архив пополняется при публикации (`docs/legal/README.md`): человек, давший
 * согласие на прежний текст, должен суметь его прочитать — и увидеть, чем он
 * отличается от нового. Нет папки — нет и редакций.
 */
export function listArchivedVersions(id: LegalId): string[] {
  try {
    return readdirSync(archiveDir(id))
      .filter((имя) => /^\d{4}-\d{2}-\d{2}\.md$/.test(имя))
      .map((имя) => имя.slice(0, -".md".length))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Текст архивной редакции — тот же вид, что у действующей: без головного блока,
 * с теми же подстановками. Нет такой редакции или файл чужой — `null`.
 *
 * Версия приходит из адреса страницы, поэтому проверяется как дата: произвольная
 * строка в пути к файлу — это чтение чужого.
 */
export function loadArchivedBody(id: LegalId, version: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) return null;

  let текст: string;
  try {
    текст = readFileSync(path.join(archiveDir(id), `${version}.md`), "utf-8");
  } catch {
    return null;
  }

  const блок = /^---\n([\s\S]*?)\n---\n?/.exec(текст);
  if (блок === null) return null;

  const поля = разобратьБлок(блок[1] as string);
  if (поля.id !== id || поля.version !== version) return null;

  return показатьПодстановки(текст.slice(блок[0].length).trim());
}

function разобратьБлок(блок: string): Partial<Record<string, string>> {
  const поля: Record<string, string> = {};

  for (const строка of блок.split("\n")) {
    const пара = /^([a-z_]+):\s*(.*)$/.exec(строка);
    if (пара === null) continue;

    const значение = (пара[2] as string).replace(/^"(.*)"$/, "$1").trim();
    if (значение !== "" && значение !== "null") поля[пара[1] as string] = значение;
  }

  return поля;
}

/**
 * `{{ПОЧТОВЫЙ_АДРЕС}}` → `[почтовый адрес]`.
 *
 * Не пустое место и не выдуманное значение: незаполненное поле должно
 * быть видно как незаполненное. Пустое место читалось бы опечаткой, а
 * любая подстановка от себя — обещанием за владельца.
 *
 * Скобки квадратные, а не угловые (`⟨⟩`): в шрифте приложения угловых
 * нет, и браузер подставляет их из запасного — на странице они выглядят
 * обычными круглыми, то есть незаполненное поле читается как пояснение в
 * скобках. Квадратные есть везде и ни с чем не путаются.
 */
function показатьПодстановки(текст: string): string {
  return текст.replace(/\{\{([^}]+)\}\}/g, (_, имя: string) => {
    const слова = имя.trim().toLowerCase().replaceAll("_", " ");
    return `[${слова}]`;
  });
}
