/**
 * Конверт элемента: то, что лежит внутри зашифрованного блоба.
 *
 * ```json
 * { "fmt": 1, "kind": "profile", "id": "6f1e…", "updatedAt": "…", "body": {…} }
 * ```
 *
 * Раздел 3 контракта. Конверт нужен затем, что расшифрованные байты надо
 * проверить: блоб приходит с сервера, и доверять его содержимому «потому
 * что он расшифровался» нельзя — расшифровался он нашим ключом, но
 * записан мог быть версией приложения, которой ещё не было или уже нет.
 *
 * --- `updatedAt` у папок и записей ведёт этот слой -------------------------
 *
 * В локальном формате проводника его нет: человеку он не нужен, а
 * слиянию — нужен, и только ему. Поэтому он живёт в конверте: когда
 * строится конверт указателя, время правки берётся из базового состояния
 * (ничего не изменилось) или ставится нынешним (изменилось).
 */

import { z } from "zod";

import { parseAppearance, type Appearance } from "@/components/shared/appearance";
import { storedProfileSchema } from "@/features/shift/storage/profile";

/** Версия открытого формата элемента. */
export const FMT = 1;

/** Опознание единственного указателя библиотеки. */
export const INDEX_ID = "index";

/** Опознание единственного оформления: цвета лампы и событий, выключатели. */
export const APPEARANCE_ID = "appearance";

const iso = z.string().min(1).max(40);

export const indexFolderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  parentId: z.string().min(1).nullable(),
  updatedAt: iso,
});

export const indexEntrySchema = z.object({
  id: z.string().min(1),
  folderId: z.string().min(1),
  name: z.string().max(200),
  savedAt: iso,
  updatedAt: iso,
});

export const indexBodySchema = z.object({
  folders: z.array(indexFolderSchema).max(100),
  entries: z.array(indexEntrySchema).max(200),
});

export type IndexFolder = z.infer<typeof indexFolderSchema>;
export type IndexEntry = z.infer<typeof indexEntrySchema>;
export type IndexBody = z.infer<typeof indexBodySchema>;

const base = { fmt: z.literal(FMT), id: z.string().min(1), updatedAt: iso };

export const indexEnvelopeSchema = z.object({
  ...base,
  kind: z.literal("index"),
  body: indexBodySchema,
});

export const profileEnvelopeSchema = z.object({
  ...base,
  kind: z.literal("profile"),
  body: storedProfileSchema,
});

/**
 * Тело оформления разбирается тем же разбором, что и запись в `localStorage`
 * (`parseAppearance`), а не схемой «всё или ничего».
 *
 * Оформление — вкус, а не данные: незнакомый ключ события или негодный цвет в
 * одном конфиге не повод отвергать весь элемент и оставить человека без
 * остальных цветов. Разбор отбрасывает негодное по частям и приводит
 * остальное к виду, который понимает приложение; чего он не знает вовсе
 * (`v` другой версии), того не читает — и тело становится пустым оформлением.
 * Сам элемент при этом остаётся годным конвертом.
 */
export const appearanceBodySchema = z
  .record(z.string(), z.unknown())
  .transform((raw): Appearance => parseAppearance(JSON.stringify({ ...raw, v: 2 })));

export const appearanceEnvelopeSchema = z.object({
  ...base,
  kind: z.literal("appearance"),
  body: appearanceBodySchema,
});

export const envelopeSchema = z.discriminatedUnion("kind", [
  indexEnvelopeSchema,
  profileEnvelopeSchema,
  appearanceEnvelopeSchema,
]);

export type IndexEnvelope = z.infer<typeof indexEnvelopeSchema>;
export type ProfileEnvelope = z.infer<typeof profileEnvelopeSchema>;
export type AppearanceEnvelope = z.infer<typeof appearanceEnvelopeSchema>;
export type Envelope = z.infer<typeof envelopeSchema>;

/**
 * Разобрать расшифрованное, не веря ему.
 *
 * `null` вместо исключения: негодный конверт — это не поломка
 * приложения, а чужая или устаревшая запись, и синхронизация обязана
 * продолжиться с остальными элементами. Молча потерять её нельзя, и
 * вызывающий об этом сообщает в сводке.
 */
export function parseEnvelope(value: unknown): Envelope | null {
  const parsed = envelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Тот же разбор, но с проверкой, что конверт о том элементе, о котором спрашивали. */
export function parseEnvelopeFor(
  value: unknown,
  kind: "index" | "profile" | "appearance",
  itemId: string,
): Envelope | null {
  const конверт = parseEnvelope(value);

  if (конверт === null || конверт.kind !== kind || конверт.id !== itemId) return null;

  return конверт;
}
