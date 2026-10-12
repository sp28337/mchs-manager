import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ToCalculator } from "@/components/landing/to-calculator";
import { SiteHeader } from "@/components/shared/site-header";

import type { LegalDocument } from "./documents";

/**
 * Страница юридического документа.
 *
 * Одна на все три: политику, согласие и соглашение. Разный у них только
 * текст, а он приходит из `docs/legal/*.md` — и оформление обязано быть
 * одинаковым, иначе документы начинают выглядеть разными по весу, хотя
 * вес у них один.
 *
 * --- Почему Markdown, а не разметка в коде ----------------------------------
 *
 * Потому что текст один и тот же в трёх местах: на странице, в архиве
 * редакций и под хэшем, который сервер отдаёт в `GET /legal/documents`.
 * Вторая копия в TSX разошлась бы с первой в первую же правку, и вопрос
 * «с какой редакцией человек согласился» перестал бы иметь ответ.
 *
 * Разбор идёт **на сборке**: компонент серверный, сайт выгружается в
 * статику, и к браузеру уходит готовая разметка — ни разборщика Markdown,
 * ни файлов документов в ней нет.
 *
 * --- Почему у черновика оговорка сверху -------------------------------------
 *
 * Пока документ не опубликован (`status: draft`), у него нет даты
 * вступления в силу, а вместо имени и адреса владельца стоят
 * незаполненные поля. Человек, попавший на такую страницу, должен видеть
 * это первой строкой, а не вычитывать из текста.
 */
export function LegalPage({ document: документ }: { document: LegalDocument }) {
  return (
    <>
      <SiteHeader action={<ToCalculator size="sm">Открыть расчёт</ToCalculator>} />

      <main className="mx-auto w-full max-w-3xl px-6 pb-16 pt-26">
        {/* Своей строки о редакции у страницы нет: первым абзацем это
            говорит сам документ («Редакция от … Вступает в силу с …»), а
            два одинаковых утверждения подряд читаются как ошибка. */}
        {документ.status === "draft" && (
          <p className="rounded-xl border border-rule bg-paper-raised px-4 py-3 text-sm text-ink-muted">
            <strong className="font-medium text-ink">Проект документа.</strong> Он
            ещё не опубликован и юридической силы не имеет: учётные записи
            не включены, обработки персональных данных нет. Незаполненные
            поля в тексте показаны в квадратных скобках — имя и почтовый
            адрес владельца подставляются при публикации.
          </p>
        )}

        {/* Текст документа. Заголовок первого уровня приходит из самого
            файла, поэтому своего заголовка у страницы нет: двух `h1`
            подряд не бывает. */}
        <div className="mt-8">
          <Markdown remarkPlugins={[remarkGfm]} components={ОФОРМЛЕНИЕ}>
            {документ.body}
          </Markdown>
        </div>

        <p className="mt-14 border-t border-rule pt-6 text-xs text-ink-faint">
          Остальные документы:{" "}
          <ПрочиеДокументы id={документ.id} />.
        </p>
      </main>
    </>
  );
}

/** Ссылки на два других документа: их читают вместе. */
function ПрочиеДокументы({ id }: { id: LegalDocument["id"] }) {
  const все = [
    { id: "policy", url: "/privacy", label: "политика обработки данных" },
    { id: "consent", url: "/consent", label: "согласие" },
    { id: "terms", url: "/terms", label: "условия использования" },
  ] as const;

  const прочие = все.filter((документ) => документ.id !== id);

  return (
    <>
      {прочие.map((документ, i) => (
        <span key={документ.id}>
          {i > 0 ? ", " : ""}
          <Link href={документ.url} className="underline hover:text-ink">
            {документ.label}
          </Link>
        </span>
      ))}
    </>
  );
}

/**
 * Оформление элементов Markdown.
 *
 * Тем же языком, что остальные документы сайта: заголовки без украшений,
 * текст в меру узкой колонкой, таблицы линовкой, а не рамками. Классы
 * стоят здесь, а не в `globals.css`, по одной причине — рядом видно, что
 * чему отвечает.
 */
const ОФОРМЛЕНИЕ = {
  h1: (props: React.ComponentProps<"h1">) => (
    <h1 {...props} className="text-3xl leading-[1.15] md:text-4xl" />
  ),
  h2: (props: React.ComponentProps<"h2">) => (
    <h2
      {...props}
      className="mt-12 scroll-mt-24 border-t border-rule pt-8 text-2xl md:text-3xl"
    />
  ),
  h3: (props: React.ComponentProps<"h3">) => (
    <h3
      {...props}
      className="mt-8 font-display text-base font-bold uppercase tracking-wide"
    />
  ),
  h4: (props: React.ComponentProps<"h4">) => (
    <h4 {...props} className="mt-6 font-medium text-ink" />
  ),
  p: (props: React.ComponentProps<"p">) => (
    <p {...props} className="mt-3 max-w-prose text-sm leading-6 text-ink-muted" />
  ),
  ul: (props: React.ComponentProps<"ul">) => (
    <ul
      {...props}
      className="mt-3 max-w-prose list-disc space-y-1.5 pl-5 text-sm leading-6 text-ink-muted"
    />
  ),
  ol: (props: React.ComponentProps<"ol">) => (
    <ol
      {...props}
      className="mt-3 max-w-prose list-decimal space-y-1.5 pl-5 text-sm leading-6 text-ink-muted"
    />
  ),
  li: (props: React.ComponentProps<"li">) => <li {...props} className="pl-1" />,
  strong: (props: React.ComponentProps<"strong">) => (
    <strong {...props} className="font-medium text-ink" />
  ),
  a: ({ href, ...props }: React.ComponentProps<"a">) =>
    // Внутренние ссылки — через `next/link`: переход между документами не
    // должен перезагружать страницу.
    href !== undefined && href.startsWith("/") ? (
      <Link href={href} {...props} className="text-ink underline" />
    ) : (
      <a href={href} {...props} className="text-ink underline" />
    ),
  code: (props: React.ComponentProps<"code">) => (
    <code
      {...props}
      className="rounded bg-paper-sunken px-1 py-0.5 font-mono text-[0.85em] text-ink"
    />
  ),
  pre: (props: React.ComponentProps<"pre">) => (
    <pre
      {...props}
      className="mt-4 overflow-x-auto rounded-xl bg-paper-sunken p-4 text-xs leading-5 text-ink-muted"
    />
  ),
  blockquote: (props: React.ComponentProps<"blockquote">) => (
    <blockquote
      {...props}
      className="mt-4 max-w-prose border-l-2 border-rule pl-4 text-sm leading-6 text-ink-faint"
    />
  ),
  hr: (props: React.ComponentProps<"hr">) => (
    <hr {...props} className="mt-10 border-rule" />
  ),
  // Таблица уезжает вбок на телефоне, а не ломает раскладку: в документах
  // попадаются таблицы в пять столбцов.
  table: (props: React.ComponentProps<"table">) => (
    <div className="mt-4 -mx-6 overflow-x-auto px-6">
      <table {...props} className="w-full min-w-[32rem] border-collapse text-sm" />
    </div>
  ),
  thead: (props: React.ComponentProps<"thead">) => (
    <thead {...props} className="border-b border-rule text-left" />
  ),
  th: (props: React.ComponentProps<"th">) => (
    <th
      {...props}
      className="py-2 pr-4 align-top text-xs font-medium uppercase tracking-wide text-ink-faint"
    />
  ),
  td: (props: React.ComponentProps<"td">) => (
    <td
      {...props}
      className="border-b border-rule py-2 pr-4 align-top leading-6 text-ink-muted"
    />
  ),
};
