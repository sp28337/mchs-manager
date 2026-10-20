/**
 * Ответы сервера — разбираются схемой, а не читаются как есть.
 *
 * Схема здесь не паранойя: ответ приходит по сети и может прийти от
 * другой версии сервера. Разобранный схемой ответ либо годен целиком,
 * либо отвергнут целиком — и это лучше, чем `undefined`, всплывающий
 * через три экрана после запроса.
 *
 * Имена полей серверные (`wrapped_dek_pwd`, `min_rev_available`): это
 * граница, и переименовывать на ней значило бы держать в голове две
 * таблицы соответствий вместо одной.
 */

import { z } from "zod";

import { kdfParamsSchema } from "../crypto";

export const consentSchema = z.object({
  kind: z.enum(["policy", "consent", "terms"]),
  version: z.string(),
  accepted_at: z.string(),
});

export const accountSchema = z.object({
  id: z.string(),
  email: z.string(),
  email_verified: z.boolean(),
  created_at: z.string(),
  rev: z.number().int().nonnegative(),
  consents: z.array(consentSchema),
  /**
   * Документы, на которые надо ответить заново: их редакция сменилась после
   * принятия. Пусто — спрашивать нечего. `default`, а не обязательное поле:
   * ответ сервера без него — это сервер без повторного принятия, и ждать от него
   * вопроса не о чем.
   */
  consent_pending: z.array(z.enum(["consent", "terms"])).default([]),
});

export type Account = z.infer<typeof accountSchema>;

export const sessionSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  wrapped_dek_pwd: z.string().nullish(),
  kdf: kdfParamsSchema,
  account: accountSchema,
});

export type Session = z.infer<typeof sessionSchema>;

export const itemSchema = z.object({
  id: z.string(),
  kind: z.enum(["index", "profile"]),
  rev: z.number().int().positive(),
  deleted: z.boolean(),
  updated_at: z.string(),
  size: z.number().int().nonnegative(),
  blob: z.string().nullish(),
});

export type RemoteItem = z.infer<typeof itemSchema>;

export const pullSchema = z.object({
  rev: z.number().int().nonnegative(),
  min_rev_available: z.number().int().nonnegative(),
  items: z.array(itemSchema),
  has_more: z.boolean(),
});

export type Pull = z.infer<typeof pullSchema>;

export const pushSchema = z.object({
  rev: z.number().int().nonnegative(),
  applied: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["index", "profile"]),
      rev: z.number().int().positive(),
    }),
  ),
  conflicts: z.array(itemSchema),
});

export type Push = z.infer<typeof pushSchema>;

/** Ответ `POST /auth/recover/claim`: обёртка ключа восстановления. */
export const claimSchema = z.object({
  email: z.string(),
  wrapped_dek_rec: z.string().min(1),
  kdf: kdfParamsSchema,
});

export const usageSchema = z.object({ items: z.number(), bytes: z.number() });

export const accountInfoSchema = accountSchema.extend({ usage: usageSchema });

export type AccountInfo = z.infer<typeof accountInfoSchema>;

/** Что отправляют в `POST /sync`. */
export interface PushItem {
  id: string;
  kind: "index" | "profile";
  base_rev: number;
  mutation_id: string;
  deleted: boolean;
  blob?: string;
}
