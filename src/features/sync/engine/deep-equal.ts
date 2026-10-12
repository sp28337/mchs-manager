/**
 * Сравнение значений по содержимому.
 *
 * Нужно слиянию: «изменилось ли поле с тех пор, как сервер его
 * подтвердил». Сравнивать строками JSON нельзя — порядок ключей в объекте
 * зависит от того, как объект собран, и переписанный тем же значением
 * профиль выглядел бы изменённым. Лишняя отправка это полбеды; хуже, что
 * такой «конфликт» спрашивал бы человека о расхождении, которого нет.
 *
 * Своё, а не библиотека: сравнивать нужно JSON-значения — то, что уже
 * прошло схему zod, — а это шесть строк.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((значение, i) => deepEqual(значение, b[i]));
  }

  const первый = a as Record<string, unknown>;
  const второй = b as Record<string, unknown>;
  const ключи = Object.keys(первый);

  if (ключи.length !== Object.keys(второй).length) return false;

  return ключи.every(
    (ключ) => Object.hasOwn(второй, ключ) && deepEqual(первый[ключ], второй[ключ]),
  );
}
