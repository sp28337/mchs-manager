/**
 * Вход, регистрация и права субъекта — связка крипто, сети и хранилища.
 *
 * Здесь нет ни правил шифрования (они в `crypto/`), ни знания о HTTP
 * (оно в `api/`): этот модуль только собирает их в порядок, который
 * описан в разделе 2.6 контракта. Экран (`ui/`) зовёт одну функцию на
 * действие человека и получает значение, а не последовательность шагов.
 *
 * --- Почему ключ данных остаётся в хранилище слоя --------------------------
 *
 * Иначе пароль пришлось бы вводить при каждом открытии страницы: ключ
 * выводится из него, а пароль мы не храним. Подробности — в докстринге
 * `store/vault.ts`; коротко: на этом устройстве профили и так лежат
 * открытым текстом в `localStorage`, и сквозное шифрование защищает
 * данные на сервере, а не от того, кто сел за чужой компьютер.
 */

import type { ApiClient } from "./api/client";
import {
  accountInfoSchema,
  sessionSchema,
  type Account,
  type AccountInfo,
  type Session,
} from "./api/schemas";
import {
  changePassword as rewrapForNewPassword,
  createAccount,
  finishRecovery,
  formatRecoveryKey,
  KDF_V1,
  kdfParamsSchema,
  normalizeEmail,
  type DataKey,
  type KdfParams,
} from "./crypto";
// Напрямую из модулей крипто-слоя: наружу он отдаёт готовые случаи
// (`createAccount`, `unlockWithPassword`), а здесь нужен порядок, которого
// среди них нет, — сначала опознание, потом разворачивание присланной
// сервером обёртки.
import { unwrapDataKey } from "./crypto/dek";
import { derivePasswordKeys } from "./crypto/kdf";
import { consentPayload } from "./legal";
import { claimSchema } from "./api/schemas";
import { clearVault, loadDataKey, readMeta, saveDataKey, writeMeta } from "./store/vault";

export interface Unlocked {
  session: Session;
  dataKey: DataKey;
}

/** Параметры вывода ключа для этого адреса. Ответ один и для незнакомого. */
export async function kdfParams(client: ApiClient, email: string): Promise<KdfParams> {
  const ответ = await client.request("/auth/params", {
    method: "POST",
    anonymous: true,
    body: { email },
  });

  return kdfParamsSchema.parse(ответ);
}

export interface Registered extends Unlocked {
  /** Показать один раз и предложить напечатать. */
  recoveryKey: string;
  recoveryKeyPrinted: string;
}

/**
 * Регистрация.
 *
 * Параметры берутся у сервера до того, как считать ключи: у аккаунта они
 * свои, и однажды поднятые (`kdf_v2`) не должны ломать вход тем, кто
 * зарегистрировался раньше. Если сервер недоступен — дальше идти
 * незачем, и человеку скажут про сеть, а не про пароль.
 */
export async function register(
  client: ApiClient,
  данные: { email: string; password: string },
): Promise<Registered> {
  const params = await kdfParams(client, данные.email).catch(() => KDF_V1);
  const ключи = await createAccount(данные.email, данные.password, params);

  const ответ = sessionSchema.parse(
    await client.request("/auth/register", {
      method: "POST",
      anonymous: true,
      body: {
        email: normalizeEmail(данные.email),
        verifier: ключи.verifier,
        wrapped_dek_pwd: ключи.wrapped_dek_pwd,
        wrapped_dek_rec: ключи.wrapped_dek_rec,
        kdf_version: ключи.kdf_version,
        consent: consentPayload(),
      },
    }),
  );

  await принять(client, ответ, ключи.dataKey);

  return {
    session: ответ,
    dataKey: ключи.dataKey,
    recoveryKey: ключи.recoveryKey,
    recoveryKeyPrinted: formatRecoveryKey(ключи.recoveryKey),
  };
}

/** Вход по адресу и паролю. */
export async function login(
  client: ApiClient,
  данные: { email: string; password: string },
): Promise<Unlocked> {
  const params = await kdfParams(client, данные.email);
  const { verifier, wrappingKey } = await derivePasswordKeys(данные.email, данные.password, params);

  const ответ = sessionSchema.parse(
    await client.request("/auth/login", {
      method: "POST",
      anonymous: true,
      body: { email: normalizeEmail(данные.email), verifier },
    }),
  );

  if (typeof ответ.wrapped_dek_pwd !== "string") {
    throw new Error("сервер не прислал обёртку ключа данных");
  }

  const dataKey = await unwrapDataKey(ответ.wrapped_dek_pwd, wrappingKey, "password");

  await принять(client, ответ, dataKey);

  return { session: ответ, dataKey };
}

/**
 * Продолжить сессию после перезагрузки страницы.
 *
 * Access-токен живёт в памяти вкладки и перезагрузку не переживает, а
 * refresh-cookie — переживает. Ключ данных лежит в хранилище слоя.
 * `null` означает «входа нет»: ни cookie, ни ключа, — и приложение
 * работает как до появления аккаунта.
 */
export async function restore(client: ApiClient): Promise<Unlocked | null> {
  const handle = await loadDataKey();
  if (handle === null) return null;

  const ответ = sessionSchema.parse(await client.refresh());
  client.setAccessToken(ответ.access_token);

  const dataKey: DataKey = { handle };
  await запомнить(ответ.account);

  return { session: ответ, dataKey };
}

/** Выход: сессия на сервере гаснет, ключ и ревизии уходят с устройства. */
export async function logout(client: ApiClient): Promise<void> {
  try {
    await client.request("/auth/logout", { method: "POST" });
  } finally {
    // Хранилище чистится в любом случае: если сервер недоступен, сессия
    // на нём догаснет сама, а держать ключ данных на устройстве после
    // того, как человек нажал «выйти», нельзя.
    client.setAccessToken(null);
    await clearVault();
  }
}

/** Сведения об аккаунте (ст. 14 152-ФЗ). */
export async function accountInfo(client: ApiClient): Promise<AccountInfo> {
  return accountInfoSchema.parse(await client.request("/account"));
}

/** Выгрузка всего, что о человеке есть. Возвращает готовый к записи текст. */
export async function exportAll(client: ApiClient): Promise<string> {
  const данные = await client.request<unknown>("/account/export");
  return JSON.stringify(данные, null, 2);
}

/** Смена пароля: перешифровывается обёртка, данные не трогаются. */
export async function changePassword(
  client: ApiClient,
  данные: {
    email: string;
    currentPassword: string;
    newPassword: string;
    wrappedDekPwd: string;
    newRecoveryKey?: string;
  },
): Promise<void> {
  const params = await kdfParams(client, данные.email);
  const тело = await rewrapForNewPassword(
    данные.email,
    {
      currentPassword: данные.currentPassword,
      newPassword: данные.newPassword,
      wrappedDekPwd: данные.wrappedDekPwd,
      ...(данные.newRecoveryKey === undefined
        ? {}
        : { newRecoveryKey: данные.newRecoveryKey }),
    },
    params,
  );

  await client.request("/account/password", { method: "POST", body: тело });
}

/**
 * Удалить аккаунт со всеми данными.
 *
 * Проверочное значение считается заново из пароля: сервер спрашивает его
 * перед опасным действием, и украденного access-токена не должно хватать,
 * чтобы стереть человеку год работы. Профили на устройстве остаются:
 * человек удалил аккаунт, а не свой график.
 */
export async function deleteAccount(
  client: ApiClient,
  данные: { email: string; password: string },
): Promise<void> {
  const params = await kdfParams(client, данные.email);
  const { verifier } = await derivePasswordKeys(данные.email, данные.password, params);

  await client.request("/account", { method: "DELETE", body: { verifier } });
  client.setAccessToken(null);
  await clearVault();
}

/** Подтвердить адрес по ссылке из письма. */
export async function verifyEmail(client: ApiClient, token: string): Promise<void> {
  await client.request("/auth/verify-email", {
    method: "POST",
    anonymous: true,
    body: { token },
  });
}

/** Попросить письмо для восстановления доступа. Ответ один для любого адреса. */
export async function recoverStart(client: ApiClient, email: string): Promise<void> {
  await client.request("/auth/recover/start", {
    method: "POST",
    anonymous: true,
    body: { email: normalizeEmail(email) },
  });
}

/**
 * Что отдаёт сервер по ссылке из письма (`POST /auth/recover/claim`).
 *
 * Ссылка при этом НЕ гасится: ею же завершают восстановление. Обёртка
 * ключа восстановления бесполезна без самого ключа — 128 бит, которые
 * человек переписал на бумагу, — поэтому отдать её тому, кто читает
 * почту, безопасно.
 */
export interface RecoveryClaim {
  email: string;
  wrapped_dek_rec: string;
  kdf: KdfParams;
}

export async function recoverClaim(
  client: ApiClient,
  token: string,
): Promise<RecoveryClaim> {
  const ответ = await client.request<unknown>("/auth/recover/claim", {
    method: "POST",
    anonymous: true,
    body: { token },
  });

  return claimSchema.parse(ответ);
}

/**
 * Задать новый пароль по ссылке из письма и ключу восстановления.
 *
 * Ключ восстановления на сервер не уходит: им браузер разворачивает ключ
 * данных сам и присылает новую обёртку паролем. Обёртку ключом
 * восстановления экран получает до этого — `recoverClaim` по той же
 * ссылке.
 */
export async function recoverFinish(
  client: ApiClient,
  данные: {
    email: string;
    token: string;
    recoveryKey: string;
    newPassword: string;
    wrappedDekRec: string;
  },
): Promise<void> {
  const params = await kdfParams(client, данные.email);
  const тело = await finishRecovery(
    данные.email,
    {
      recoveryKey: данные.recoveryKey,
      newPassword: данные.newPassword,
      wrappedDekRec: данные.wrappedDekRec,
    },
    params,
  );

  await client.request("/auth/recover/finish", {
    method: "POST",
    anonymous: true,
    body: {
      token: данные.token,
      verifier: тело.verifier,
      wrapped_dek_pwd: тело.wrapped_dek_pwd,
      kdf_version: тело.kdf_version,
    },
  });
}

async function принять(client: ApiClient, ответ: Session, dataKey: DataKey): Promise<void> {
  client.setAccessToken(ответ.access_token);
  await saveDataKey(dataKey.handle);
  await запомнить(ответ.account);
}

async function запомнить(account: Account): Promise<void> {
  const было = await readMeta();

  // Курсор сбрасывается, если аккаунт другой: ревизии у каждого свои, и
  // выбирать «изменения после 42» из чужой истории нельзя.
  const свой = было?.accountId === account.id;

  await writeMeta({
    accountId: account.id,
    email: account.email,
    cursor: свой ? (было?.cursor ?? 0) : 0,
    syncedAt: свой ? (было?.syncedAt ?? null) : null,
  });
}
