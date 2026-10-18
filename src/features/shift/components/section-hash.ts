/**
 * Адреса разделов рабочего экрана: `/calculator#settings` открывает его
 * сразу на настройках.
 *
 * Нужны странице учётной записи и подвалу сайта. Раздел рабочего экрана — состояние
 * самого экрана, а не адрес, и из другой страницы до него иначе не
 * дотянуться: нажатие по строке меню там должно привести на расчёт уже с
 * открытым разделом, а не на расчёт, где его ещё предстоит открыть.
 * Рабочий экран читает адрес один раз при открытии и тут же стирает его
 * (`sectionFromHash`).
 *
 * Модуль без `"use client"` намеренно: подвал сайта — серверный компонент, и
 * значения из клиентского модуля дошли бы до него ссылками, а не строками.
 */
export const SECTION_HASH = {
  settings: "settings",
  events: "events",
  stats: "stats",
  graphs: "graphs",
  save: "save",
} as const;

export type SectionHash = (typeof SECTION_HASH)[keyof typeof SECTION_HASH];

/** Раздел из адреса страницы или `null`, если адрес ни о каком не просит. */
export function sectionFromHash(): SectionHash | null {
  if (typeof window === "undefined") return null;
  const name = window.location.hash.slice(1);
  return Object.values(SECTION_HASH).find((hash) => hash === name) ?? null;
}
