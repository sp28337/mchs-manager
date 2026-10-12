/**
 * Криптомодуль синхронизации: сервер хранит данные, ключа у него нет.
 *
 * Весь обмен с сервером шифруется здесь, в браузере. Это не украшение, а
 * условие, при котором сервер вообще можно заводить: в профиле есть
 * больничные, то есть сведения о состоянии здоровья (ст. 10 152-ФЗ), а
 * согласие на их обработку нужно письменное либо с электронной подписью
 * (ч. 4 ст. 9) — галочки на сайте недостаточно. Сервер, который хранит
 * нечитаемый блоб и ключа не имеет, таких сведений не обрабатывает.
 *
 * Отсюда правило, которое не обсуждается: наружу уходит только то, что
 * вернули функции `account.ts`. Пароля, ключа восстановления и ключа
 * данных среди них нет.
 *
 * Схема целиком — [`docs/sync-contract.md`](../../../../docs/sync-contract.md),
 * раздел 2. Каждому его пункту отвечает модуль:
 *
 * | Раздел контракта | Модуль |
 * |---|---|
 * | 2.1 вывод ключей | `kdf.ts` |
 * | 2.3 ключ данных и обёртки | `dek.ts` |
 * | 2.4 ключ восстановления | `recovery.ts` |
 * | 2.5 шифрование блобов | `blob.ts` |
 * | 2.6 регистрация, вход, смена пароля, восстановление | `account.ts` |
 */

export {
  changePassword,
  createAccount,
  encryptItem,
  finishRecovery,
  type NewAccount,
  type PasswordChange,
  type RecoveredAccess,
  type Unlocked,
  unlockWithPassword,
} from "./account";
export {
  decryptBlob,
  decryptJson,
  encryptBlob,
  encryptJson,
  INDEX_ID,
  type ItemKind,
  type ItemRef,
} from "./blob";
export { type DataKey, type WrapKind } from "./dek";
export {
  CryptoError,
  CryptoFormatError,
  CryptoKeyMismatchError,
  RecoveryKeyError,
} from "./errors";
export {
  KDF_V1,
  type KdfParams,
  kdfParamsSchema,
  normalizeEmail,
} from "./kdf";
export {
  formatRecoveryKey,
  generateRecoveryKey,
  parseRecoveryKey,
} from "./recovery";
