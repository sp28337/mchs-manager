"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { LoadingCurtain } from "@/components/ui/loading-curtain";

/**
 * Загрузка при переходе между страницами: знак сайта поверх страницы, которую
 * человек покидает, пока новая не открылась.
 *
 * --- Зачем это нужно, если есть `loading.tsx` ----------------------------------
 *
 * Сайт выгружается в статику, а для статического экспорта `loading.tsx` не
 * поддерживается вовсе: мгновенного состояния «идём на страницу» сервер не
 * присылает. В боевой сборке переходы и так быстры — страницы готовы и
 * подгружены заранее, — а на `next dev` страницу сначала собирают, и между
 * нажатием на ссылку и новым экраном проходят секунды, в которые прежняя
 * страница стоит как ни в чём не бывало: нажатие не отозвалось, и неясно,
 * приняла ли его программа. Знак отвечает: приняла, идём.
 *
 * --- Как узнаётся, что переход начался ---------------------------------------
 *
 * У маршрутизатора приложения нет события «переход начался»: он меняет адрес
 * лишь тогда, когда страница готова. Поэтому начало ловится двумя путями:
 *
 * * нажатие на ссылку: `Link` уже отменил переход браузера (`defaultPrevented`)
 *   и повёл его сам — значит, это переход внутри приложения; ссылки, которые
 *   браузер грузит сам, знак не получают, ему там нечего показывать;
 * * `useNavigate` — для переходов из кода (`router.push` после входа или после
 *   построения графика): они ни на какую ссылку не нажимаются.
 *
 * Плюс «назад» и «вперёд» браузера.
 *
 * Кончается переход сменой адреса (`usePathname`). Если страница так и не
 * открылась (ошибка сборки, обрыв), через десять секунд знак уходит сам: закрытая
 * им страница не должна оставаться закрытой навсегда.
 *
 * --- Почему не сразу -----------------------------------------------------------
 *
 * Быстрый переход — а в боевой сборке он почти всегда быстрый — не должен мигать
 * знаком: он показывается, лишь если страница не открылась за `SHOW_AFTER_MS`.
 * Сам знак ещё и проступает из пустоты (`globals.css`), так что даже при долгом
 * ожидании экран не вспыхивает.
 *
 * --- Как уходит ----------------------------------------------------------------
 *
 * Когда страница открылась, знак не пропадает в один кадр, а растворяется
 * (`LoadingCurtain`), и новая страница проступает сквозь него. Растворяется он
 * и когда мы отступились (десять секунд), и поверх экрана расчёта, у которого
 * есть своя такая же плёнка, — одна передаёт место другой.
 */

/** Сколько ждать, прежде чем показать знак: быстрый переход мигать не должен. */
const SHOW_AFTER_MS = 120;

/** Через сколько отступиться, если страница так и не открылась. */
const GIVE_UP_MS = 10_000;

// --- Состояние: куда идём --------------------------------------------------------

/** Адрес (путь) страницы, на которой мы сейчас, — для сравнения с целью перехода. */
let current: string | null = null;
/**
 * Переход, который идёт; `null` — никакой. Номер у каждого свой: к тому же
 * адресу можно пойти дважды, и показ знака, заданный для первого перехода, ко
 * второму отношения не имеет.
 */
interface Going {
  path: string;
  id: number;
}

let target: Going | null = null;
let serial = 0;

const listeners = new Set<() => void>();

function setTarget(next: string | null): void {
  if (next === null) {
    if (target === null) return;
    target = null;
  } else {
    if (target?.path === next) return;
    serial += 1;
    target = { path: next, id: serial };
  }

  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Сообщить, что начался переход на `href`.
 *
 * Переход на ту же страницу (другой якорь, тот же адрес) и на чужой сайт
 * ничего не начинает: страница не сменится, и знак остался бы висеть.
 */
export function startNavigation(href: string): void {
  if (typeof window === "undefined" || current === null) return;

  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) return;
  if (url.pathname === current) return;

  setTarget(url.pathname);
}

/**
 * Переходы из кода — с загрузкой. Заменяет `useRouter().push/replace` там, где
 * человек должен увидеть, что переход пошёл.
 */
export function useNavigate(): {
  push: (href: string) => void;
  replace: (href: string) => void;
} {
  const router = useRouter();

  return useMemo(
    () => ({
      push: (href: string) => {
        startNavigation(href);
        router.push(href);
      },
      replace: (href: string) => {
        startNavigation(href);
        router.replace(href);
      },
    }),
    [router],
  );
}

// --- Знак ---------------------------------------------------------------------------

export function NavigationLoading() {
  const pathname = usePathname();
  const going = useSyncExternalStore(
    subscribe,
    () => target,
    () => null,
  );
  /** Для какого перехода знак уже пора показывать: задаётся таймером, не при отрисовке. */
  const [shownFor, setShownFor] = useState<number | null>(null);

  // Страница сменилась — переход состоялся. Заодно это «текущая страница» для
  // сравнения в `startNavigation`.
  useEffect(() => {
    current = pathname;
    setTarget(null);
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // Не отменено — значит, ссылку ведёт браузер, а не приложение.
      if (!event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target !== "" && link.target !== "_self") return;
      if (link.hasAttribute("download")) return;

      startNavigation(link.href);
    };

    const onPopState = () => startNavigation(window.location.href);

    document.addEventListener("click", onClick);
    window.addEventListener("popstate", onPopState);

    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    if (going === null) return;

    const show = window.setTimeout(() => setShownFor(going.id), SHOW_AFTER_MS);
    const giveUp = window.setTimeout(() => setTarget(null), GIVE_UP_MS);

    return () => {
      window.clearTimeout(show);
      window.clearTimeout(giveUp);
    };
  }, [going]);

  // Знак ушёл вместе с переходом — но не рывком: плёнка сама растворяется
  // (`LoadingCurtain`) и снимается из разметки, когда растворится.
  const visible = going !== null && shownFor === going.id;

  return <LoadingCurtain show={visible} label="Загружаем страницу" variant="navigation" />;
}
