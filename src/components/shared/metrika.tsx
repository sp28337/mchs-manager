"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { useCookieConsent } from "@/features/consent/cookie-consent";

/**
 * Счётчик посещений — только после согласия и только если он настроен.
 *
 * --- Почему номер счётчика в переменной сборки ------------------------------
 *
 * Тот же приём, что у синхронизации (`sync/ui/enabled.ts`): номер задаётся
 * переменной `NEXT_PUBLIC_METRIKA_ID` при сборке. Нет переменной — нет ни
 * счётчика, ни полосы с вопросом о нём, ни упоминаний в интерфейсе. Так
 * сборка для разработки и для проверок не шлёт ничего наружу, а живой сайт
 * считает посещения.
 *
 * --- Почему загрузка в эффекте, а не тегом в разметке -----------------------
 *
 * Потому что до ответа человека счётчика быть не должно совсем. Тег в
 * разметке загрузился бы вместе со страницей — то есть до согласия, — и
 * никакие дальнейшие проверки этого бы уже не исправили: cookie поставлена,
 * обращение к `mc.yandex.ru` сделано.
 *
 * --- Почему «Вебвизор» выключен ---------------------------------------------
 *
 * Вебвизор записывает движение указателя и нажатия клавиш. На страницах
 * сайта есть поля адреса и пароля, и такая запись была бы сбором ровно того,
 * чего оператор не собирает. Выключен он и в настройках счётчика, и здесь —
 * чтобы включить его было нельзя по невнимательности.
 *
 * --- Почему переходы считаются отдельно -------------------------------------
 *
 * Сайт — одностраничное приложение: при переходе с посадочной на расчёт
 * браузер страницу не перезагружает, и счётчик сам о переходе не узнаёт.
 * Поэтому при смене адреса ему отправляется `hit`. Первый адрес считает сам
 * `init` — иначе первое посещение было бы посчитано дважды.
 */

/** Номер счётчика. `undefined` — счётчика в этой сборке нет. */
export const METRIKA_ID: string | undefined =
  process.env.NEXT_PUBLIC_METRIKA_ID === undefined ||
  process.env.NEXT_PUBLIC_METRIKA_ID === ""
    ? undefined
    : process.env.NEXT_PUBLIC_METRIKA_ID;

type Ym = ((...args: unknown[]) => void) & { a?: unknown[][]; l?: number };

declare global {
  interface Window {
    ym?: Ym;
  }
}

export function Metrika() {
  const { choice } = useCookieConsent();
  const путь = usePathname();
  /** Первый адрес считает `init`; отсюда отправляются только переходы. */
  const считался = useRef<string | null>(null);

  useEffect(() => {
    if (METRIKA_ID === undefined || choice !== "all") return;

    if (window.ym === undefined) {
      // Очередь вызовов до загрузки тега — та же, что в официальной
      // вставке: вызовы складываются в `ym.a` и выполняются, когда тег
      // приедет.
      const ym: Ym = (...args: unknown[]) => {
        (ym.a ??= []).push(args);
      };
      ym.a = [];
      ym.l = Date.now();
      window.ym = ym;

      const тег = document.createElement("script");
      тег.async = true;
      тег.src = "https://mc.yandex.ru/metrika/tag.js";
      document.head.append(тег);

      window.ym(METRIKA_ID, "init", {
        clickmap: true,
        trackLinks: true,
        accurateTrackBounce: true,
        webvisor: false,
      });
      считался.current = путь;
      return;
    }

    if (считался.current !== путь) {
      считался.current = путь;
      window.ym(METRIKA_ID, "hit", window.location.href);
    }
  }, [choice, путь]);

  return null;
}
