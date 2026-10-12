/**
 * Версии документов, которые человек принимает при регистрации.
 *
 * Согласие доказуемо ровно настолько, насколько известно, С ЧЕМ человек
 * согласился: в записи о согласии сервер хранит версии трёх документов,
 * время и адрес IP (ч. 1 ст. 9 152-ФЗ). Версия — дата редакции из
 * головного блока файла в `docs/legal/`.
 *
 * Перечень лежит здесь, а не приходит с сервера, по той же причине, что и
 * на сервере (`api/src/grafik_api/core/legal.py`): до шага 12 ручки
 * `GET /legal/documents` нет, а сверяет их тест (`legal.test.ts`) — с
 * теми же файлами. Разойтись перечни не должны: сервер отвергнет
 * регистрацию с устаревшей версией, и человек увидит отказ, причины
 * которого в интерфейсе нет.
 */

export const LEGAL_VERSIONS = {
  policy: "2026-10-12",
  consent: "2026-10-11",
  terms: "2026-10-11",
} as const;

/** Адреса документов на сайте. Страницы появятся на шаге 12. */
export const LEGAL_URLS = {
  policy: "/privacy",
  consent: "/consent",
  terms: "/terms",
} as const;

/** То, что уходит в `POST /auth/register`. */
export function consentPayload() {
  return {
    policy_version: LEGAL_VERSIONS.policy,
    consent_version: LEGAL_VERSIONS.consent,
    terms_version: LEGAL_VERSIONS.terms,
  };
}
