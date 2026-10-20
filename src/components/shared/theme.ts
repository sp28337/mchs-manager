/**
 * Тема оформления: какие бывают, как хранится выбор и как кладётся класс на
 * корень документа ДО первой отрисовки.
 *
 * --- Почему отдельным файлом, без «use client» --------------------------------
 *
 * Сценарий ниже вставляется в разметку страницы (`app/layout.tsx`), а она
 * собирается на сервере. Клиентский модуль подменяется там заглушкой, и любое
 * обращение к его постоянной с сервера — ошибка (та же причина, по которой
 * общее у лампы лежит в `lamp-colour.ts`). Клиентский провайдер — рядом, в
 * `theme-provider.tsx`, и берёт всё отсюда.
 *
 * --- Почему не `next-themes` -------------------------------------------------
 *
 * Библиотека рисовала свой сценарий `<script>` из клиентского компонента, и
 * React 19 в режиме разработки печатал на это предупреждение («Encountered a
 * script tag while rendering React component»): скрипты в клиентских
 * компонентах никогда не выполняются при отрисовке на клиенте. Последняя версия
 * библиотеки (0.4.6) этого не лечит. Нужное нам — три положения, класс на
 * корне и память о выборе, — укладывается в сотню строк, поэтому своё: сценарий
 * стоит в серверном компоненте рядом с остальными такими же (`LAMP_MARK_SCRIPT`,
 * `APPEARANCE_MARK_SCRIPT`), и React его на клиенте не создаёт.
 *
 * Ключ хранилища и класс те же, что были у библиотеки (`theme`, `light`/`dark`
 * на `html`): выбор тех, кто уже пользовался сайтом, сохраняется, а таблица
 * стилей и лампа читают тот же класс.
 */

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** Умолчание тому, кто ещё ничего не выбирал: приложение нарисовано тёмным. */
export const DEFAULT_THEME: Theme = "dark";

export const THEME_STORAGE_KEY = "theme";

export type ResolvedTheme = "light" | "dark";

/** Запись из хранилища — тема или `null`, если записи нет или она чужая. */
export function parseTheme(raw: string | null): Theme | null {
  return THEMES.find((theme) => theme === raw) ?? null;
}

/** Что рисовать: «как в системе» — это то, что сейчас у системы. */
export function resolveTheme(theme: Theme, systemDark: boolean): ResolvedTheme {
  if (theme === "system") return systemDark ? "dark" : "light";
  return theme;
}

/**
 * Класс на корне документа — до первой отрисовки.
 *
 * Выполняется, пока браузер разбирает страницу, и повторяет то, что делает
 * провайдер (`theme-provider.tsx`): читает выбор, при «как в системе» спрашивает
 * систему, кладёт `light` или `dark` на `html` и цветовую схему вместе с ним.
 * Нет записи или хранилище закрыто — умолчание. Любой сбой гасится: страница
 * без сценария — это страница без класса, то есть светлая, и ронять из-за темы
 * разметку нельзя.
 */
export const THEME_MARK_SCRIPT = `(function(){try{var s=null;try{s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})}catch(e){}var t=${JSON.stringify(THEMES)}.indexOf(s)<0?${JSON.stringify(
  DEFAULT_THEME,
)}:s;var r=t==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t;var d=document.documentElement;d.classList.remove("light","dark");d.classList.add(r);d.style.colorScheme=r}catch(e){}})()`;
