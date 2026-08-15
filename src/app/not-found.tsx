import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/shared/site-header";
import { Calculator } from "lucide-react";

/**
 * Страница несуществующего адреса.
 *
 * --- Что она должна сказать ----------------------------------------------
 *
 * По умолчанию Next отдаёт здесь «404: This page could not be found» —
 * латиницей, системным шрифтом и без единой ссылки. Человек, пришедший из
 * поиска по устаревшей ссылке, упирается в тупик на чужом языке.
 *
 * Сказать нужно три вещи, и в таком порядке: страницы нет; данные целы;
 * вот куда идти. Второе — не вежливость. Сюда легко попасть с адреса
 * вроде `/calculator/2026`, и человек, который час вносил отпуска, имеет
 * все основания решить, что расчёт пропал вместе со страницей. Он лежит в
 * браузере и никуда не делся, и об этом надо сказать прямо здесь, а не
 * оставлять догадываться.
 *
 * --- Почему адреса перечислены -------------------------------------------
 *
 * Их всего два. Список из двух пунктов — это не навигация, а прямой ответ
 * на вопрос «куда я вообще попал»: видно, что сайт маленький и состоит
 * ровно из объяснения и расчёта.
 *
 * --- Оформление -----------------------------------------------------------
 *
 * Число набрано моноширинным: в этом интерфейсе моноширинный — гарнитура
 * чисел и идентификаторов, а `404` именно код, а не заголовок.
 * Сигнальный цвет не используется: он в этом интерфейсе означает «требует
 * решения человека», а опечатка в адресе решения не требует.
 */

// `noindex` Next проставляет странице несуществующего адреса сам, второй
// такой тег был бы лишним — а `nofollow` в нём ещё и вредным: ссылки
// отсюда ведут на лендинг, и обойти их поисковику как раз полезно.
export const metadata: Metadata = {
  title: "Страница не найдена",
};

const ADDRESSES: { href: string; label: string; what: string }[] = [
  {
    href: "/",
    label: "pererabotal.ru",
    what: "как считается норма и почему отпуск её уменьшает",
  },
  {
    href: "/calculator",
    label: "pererabotal.ru/calculator",
    what: "сам расчёт: график караула, норма, сверка с табелем",
  },
];

export default function NotFound() {
  return (
    <>
      <SiteHeader
        action={
          <Link
            href="/calculator"
            className="font-semibold inline-flex gap-2 h-9 items-center rounded-xl bg-ink px-4 text-sm text-paper hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace no-underline"
          >
            <span className="hidden xxs:block">Калькулятор</span>
            <span className="xxs:hidden xs:block">
              <Calculator className="size-5" />
            </span>
          </Link>
        }
      />

      <main className="mx-auto flex min-h-lvh w-full max-w-3xl flex-col justify-center gap-6 px-6 pb-16 pt-26">
        <p className="font-mono text-6xl leading-none text-ink-faint sm:text-7xl">404</p>

        <h1 className="text-3xl leading-[1.15] sm:text-2xl md:text-4xl">Такой страницы нет</h1>

        <p className="max-w-prose text-lg text-ink-muted">
          Возможно, в адресе опечатка или ссылка устарела. На сайте всего два
          адреса, и оба перед вами.
        </p>

        {/* Главное сообщение этой страницы, а не примечание к ней. */}
        <div className="max-w-prose border-l-2 border-verify bg-verify-soft px-4 py-3">
          <p className="text-sm">
            <strong>Расчёт не потерян.</strong> Профиль, отпуска и всё
            внесённое хранятся в вашем браузере, а не на этой странице.
            Откройте калькулятор — данные будут на месте.
          </p>
        </div>

        <dl className="divide-y divide-rule border-y border-rule">
          {ADDRESSES.map((address) => (
            <div key={address.href} className="py-3">
              <dt>
                <Link href={address.href} className="font-mono text-sm text-ink">
                  {address.label}
                </Link>
              </dt>
              <dd className="text-sm text-ink-muted">{address.what}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap items-center gap-4 pt-2">
          <Link
            href="/calculator"
            className="inline-flex h-11 items-center rounded-xl bg-ink px-6 text-base font-bold text-paper no-underline hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace"
          >
            Открыть калькулятор
          </Link>
          <Link href="/" className="text-sm text-ink-muted">
            Вернуться на главную
          </Link>
        </div>
      </main>
    </>
  );
}
