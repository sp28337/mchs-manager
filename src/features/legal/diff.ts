import { z } from "zod";

/**
 * Сравнение двух редакций документа: что добавлено, что убрано, что переписано.
 *
 * Нужно для окна «Документы обновились» (`features/sync/ui/consent-renewal.tsx`):
 * человека просят подтвердить новую редакцию согласия, а читать две редакции
 * подряд и искать разницу глазами — работа, которую он не станет делать. Закон
 * требует информированного согласия (ч. 1 ст. 9 152-ФЗ), а информирует лучше
 * то, что видно сразу: убранное зачёркнуто, добавленное подсвечено.
 *
 * --- Как сравнивается ----------------------------------------------------------
 *
 * Два уровня. Сначала текст режется на части — заголовки, абзацы, пункты
 * списков, строки таблиц — и части сравниваются целиком (наибольшая общая
 * подпоследовательность): так находятся добавленные и убранные абзацы. Потом
 * убранные и добавленные части, стоящие рядом и похожие по словам, сводятся в
 * пары «было — стало», и внутри пары сравниваются слова: так переписанное
 * предложение показывается правкой, а не двумя абзацами подряд.
 *
 * Разметка Markdown с текста снимается: человеку нужны слова, а не звёздочки.
 * Неизменившиеся абзацы в показ не входят — только число их и заголовок
 * раздела, в котором дальше есть правки: иначе искать правки пришлось бы
 * в сотне строк.
 *
 * Модуль чистый — без файлов и без браузера, поэтому и проверяется тестами без
 * них. Читает файлы `changes.ts`, показывает `changes-view.tsx`.
 */

const tokenSchema = z.object({
  op: z.enum(["same", "add", "del"]),
  text: z.string(),
});

const blockSchema = z.discriminatedUnion("kind", [
  /** Раздел, в котором дальше есть правки, сам не менявшийся. */
  z.object({ kind: z.literal("heading"), text: z.string() }),
  z.object({ kind: z.literal("added"), text: z.string(), heading: z.boolean() }),
  z.object({ kind: z.literal("removed"), text: z.string(), heading: z.boolean() }),
  z.object({
    kind: z.literal("changed"),
    tokens: z.array(tokenSchema),
    heading: z.boolean(),
  }),
]);

/** Форма ответа `/legal-changes/<id>/<версия>`: её же разбирает браузер. */
export const changeSchema = z.object({
  from: z.string(),
  to: z.string(),
  blocks: z.array(blockSchema),
  /** Сколько абзацев не изменилось: в показ они не входят. */
  unchanged: z.number().int().nonnegative(),
});

export type Token = z.infer<typeof tokenSchema>;
export type ChangeBlock = z.infer<typeof blockSchema>;
export type DocumentChange = z.infer<typeof changeSchema>;

interface Part {
  text: string;
  heading: boolean;
}

/** Пара абзацев считается «переписанной», если слов общих не меньше трети. */
const SIMILAR = 0.34;

// --- Разбор Markdown на части ---------------------------------------------------

/** Слова без разметки: звёздочки, обратные кавычки, ссылки вида `[текст](адрес)`. */
function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Текст → части: заголовок, абзац, пункт списка, строка таблицы.
 *
 * Абзац в исходнике набран в несколько строк, и перенос строки смысла не
 * несёт, поэтому строки абзаца склеиваются. Пункт списка начинает новую часть,
 * а его продолжение с отступом прилипает к нему.
 */
export function toParts(markdown: string): Part[] {
  const parts: Part[] = [];
  let open: string[] | null = null;

  const flush = () => {
    if (open !== null) {
      const text = plain(open.join(" "));
      if (text !== "") parts.push({ text, heading: false });
      open = null;
    }
  };

  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd().replace(/^\s*>\s?/, "");

    if (line.trim() === "") {
      flush();
      continue;
    }

    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading !== null) {
      flush();
      parts.push({ text: plain(heading[1] as string), heading: true });
      continue;
    }

    if (/^\s*\|/.test(line)) {
      flush();
      // Разделитель шапки таблицы (`|---|---|`) слов не содержит.
      if (/^\s*\|[\s:|-]+\|?\s*$/.test(line)) continue;

      const cells = line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => plain(cell));
      parts.push({ text: cells.join(" · "), heading: false });
      continue;
    }

    const item = /^\s*(?:[*-]|\d+\.)\s+(.*)$/.exec(line);
    if (item !== null) {
      flush();
      open = [`• ${item[1] as string}`];
      continue;
    }

    if (open === null) open = [line.trim()];
    else open.push(line.trim());
  }

  flush();
  return parts;
}

// --- Наибольшая общая подпоследовательность --------------------------------------

/** Пары индексов одинаковых элементов, в порядке следования. */
function commonPairs<T>(a: readonly T[], b: readonly T[]): [number, number][] {
  const width = b.length + 1;
  const table = new Int32Array((a.length + 1) * width);

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] as number) + 1
          : Math.max(
              table[(i + 1) * width + j] as number,
              table[i * width + j + 1] as number,
            );
    }
  }

  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (
      (table[(i + 1) * width + j] as number) >= (table[i * width + j + 1] as number)
    ) {
      i += 1;
    } else {
      j += 1;
    }
  }

  return pairs;
}

// --- Слова ----------------------------------------------------------------------

const WORD = /[\p{L}\p{N}]+/gu;
const TOKEN = /[\p{L}\p{N}]+|\s+|[^\p{L}\p{N}\s]/gu;

function similarity(a: string, b: string): number {
  const first = new Set(a.toLowerCase().match(WORD) ?? []);
  const second = new Set(b.toLowerCase().match(WORD) ?? []);
  if (first.size === 0 || second.size === 0) return 0;

  let common = 0;
  for (const word of first) if (second.has(word)) common += 1;

  return common / (first.size + second.size - common);
}

/**
 * Слова одной пары «было — стало».
 *
 * Пробел между двумя правками отдельно «неизменным» не остаётся: иначе
 * «из а б» → «из в г» читалось бы как мозаика «а→в», «б→г» через пробел. Любой
 * промежуток правок собирается в одно «убрано» и одно «добавлено».
 */
export function diffWords(before: string, after: string): Token[] {
  const a = before.match(TOKEN) ?? [];
  const b = after.match(TOKEN) ?? [];

  const raw: Token[] = [];
  let i = 0;
  let j = 0;

  for (const [pi, pj] of [...commonPairs(a, b), [a.length, b.length] as [number, number]]) {
    for (; i < pi; i += 1) raw.push({ op: "del", text: a[i] as string });
    for (; j < pj; j += 1) raw.push({ op: "add", text: b[j] as string });

    if (pi < a.length) raw.push({ op: "same", text: a[pi] as string });
    i = pi + 1;
    j = pj + 1;
  }

  // Пробел и мелочь без букв, зажатые между правками, считаются правкой.
  const settled = raw.map((token, k) => {
    const prev = raw[k - 1];
    const next = raw[k + 1];

    if (
      token.op === "same" &&
      !/[\p{L}\p{N}]/u.test(token.text) &&
      prev !== undefined &&
      next !== undefined &&
      prev.op !== "same" &&
      next.op !== "same"
    ) {
      return { op: "both" as const, text: token.text };
    }
    return token;
  });

  const out: Token[] = [];
  let removed = "";
  let added = "";

  const settle = () => {
    if (removed !== "") out.push({ op: "del", text: removed });
    if (added !== "") out.push({ op: "add", text: added });
    removed = "";
    added = "";
  };

  for (const token of settled) {
    if (token.op === "del") removed += token.text;
    else if (token.op === "add") added += token.text;
    else if (token.op === "both") {
      removed += token.text;
      added += token.text;
    } else {
      settle();
      const last = out[out.length - 1];
      if (last?.op === "same") last.text += token.text;
      else out.push({ op: "same", text: token.text });
    }
  }
  settle();

  return out;
}

// --- Пары «было — стало» ----------------------------------------------------------

type RunOp =
  | { op: "removed"; part: Part }
  | { op: "added"; part: Part }
  | { op: "changed"; before: Part; after: Part };

/**
 * Убранные и добавленные части, стоящие подряд, → правки по порядку.
 *
 * Выравнивание по сходству слов: пара получается, если слов общих не меньше
 * трети и обе части — одного рода (заголовок с заголовком). Остальные остаются
 * убранными и добавленными.
 */
function alignRun(removed: readonly Part[], added: readonly Part[]): RunOp[] {
  const n = removed.length;
  const m = added.length;
  const width = m + 1;
  const score = new Float64Array((n + 1) * width);

  const gain = (r: Part, a: Part): number => {
    if (r.heading !== a.heading) return -1;
    const value = similarity(r.text, a.text);
    return value >= SIMILAR ? value : -1;
  };

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      let best = Math.max(
        score[(i + 1) * width + j] as number,
        score[i * width + j + 1] as number,
      );
      const g = gain(removed[i] as Part, added[j] as Part);
      if (g >= 0) best = Math.max(best, g + (score[(i + 1) * width + j + 1] as number));
      score[i * width + j] = best;
    }
  }

  const ops: RunOp[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    const here = score[i * width + j] as number;
    const g = gain(removed[i] as Part, added[j] as Part);

    if (g >= 0 && here === g + (score[(i + 1) * width + j + 1] as number)) {
      ops.push({ op: "changed", before: removed[i] as Part, after: added[j] as Part });
      i += 1;
      j += 1;
    } else if (here === (score[(i + 1) * width + j] as number)) {
      ops.push({ op: "removed", part: removed[i] as Part });
      i += 1;
    } else {
      ops.push({ op: "added", part: added[j] as Part });
      j += 1;
    }
  }

  for (; i < n; i += 1) ops.push({ op: "removed", part: removed[i] as Part });
  for (; j < m; j += 1) ops.push({ op: "added", part: added[j] as Part });

  return ops;
}

// --- Документ целиком --------------------------------------------------------------

/**
 * Что изменилось между двумя редакциями.
 *
 * Показываются только правки. Неизменённый заголовок раздела выводится один
 * раз перед первой правкой в нём — чтобы было понятно, где это, — а прочие
 * неизменённые части лишь считаются.
 */
export function diffDocuments(
  beforeMarkdown: string,
  afterMarkdown: string,
  from: string,
  to: string,
): DocumentChange {
  const before = toParts(beforeMarkdown);
  const after = toParts(afterMarkdown);
  const key = (part: Part) => `${part.heading ? "#" : ""}${part.text}`;

  const blocks: ChangeBlock[] = [];
  let unchanged = 0;
  let section: string | null = null;
  let sectionShown = true;

  const emit = (op: RunOp) => {
    const block: ChangeBlock =
      op.op === "changed"
        ? {
            kind: "changed",
            tokens: diffWords(op.before.text, op.after.text),
            heading: op.after.heading,
          }
        : { kind: op.op, text: op.part.text, heading: op.part.heading };
    const now = op.op === "removed" ? null : op.op === "added" ? op.part : op.after;

    if (now?.heading === true) {
      // Новый заголовок — это и есть раздел: отдельно показывать его не надо.
      section = now.text;
      sectionShown = true;
    } else if (!sectionShown && section !== null) {
      blocks.push({ kind: "heading", text: section });
      sectionShown = true;
    }

    blocks.push(block);
  };

  let i = 0;
  let j = 0;
  const end: [number, number] = [before.length, after.length];

  for (const [pi, pj] of [...commonPairs(before.map(key), after.map(key)), end]) {
    for (const op of alignRun(before.slice(i, pi), after.slice(j, pj))) emit(op);

    const same = after[pj];
    if (pi < before.length && same !== undefined) {
      if (same.heading) {
        section = same.text;
        sectionShown = false;
      } else {
        unchanged += 1;
      }
    }

    i = pi + 1;
    j = pj + 1;
  }

  return { from, to, blocks, unchanged };
}
