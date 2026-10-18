import Link from "next/link";
import type { ReactNode } from "react";

import { ScheduleMark } from "@/components/shared/schedule-mark";
import { Bone, BoneText } from "@/components/ui/bone";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils/cn";

/**
 * Подвал сайта: документы и адрес для обращений — на каждой странице.
 *
 * --- Почему на каждой ------------------------------------------------------
 *
 * Политика обязана быть доступна с любой страницы (ч. 2 ст. 18.1 152-ФЗ:
 * «опубликовать или иным образом обеспечить неограниченный доступ»), а
 * согласие и условия — то, на что человек ссылается, когда спорит. Пока
 * ссылки стояли только на посадочной, человек с рабочего экрана добирался
 * до них через главную — то есть не добирался.
 *
 * Настройки cookie здесь по той же причине: отозвать согласие должно быть
 * так же просто, как дать его (ч. 2 ст. 9 152-ФЗ — отзыв в любое время), а
 * баннер после ответа исчезает, и другого входа к этому выбору у человека
 * нет.
 *
 * --- Как он устроен и почему так ---------------------------------------------
 *
 * Подвал — продолжение шапки, а не отдельная вещь внизу страницы. В шапке
 * слева знак и название сайта, справа меню; в подвале слева те же знак и
 * название, только тише, а справа — то, чем пользуются реже меню: документы
 * и адрес. Строка читается снизу вверх так же, как сверху вниз.
 *
 * Правые колонки названы тем же голосом, каким подписаны цифры в полосе
 * итога: узкая гарнитура названий, прописные, разрядка, бледный цвет. Это
 * не заголовки разделов, а подписи — они говорят, что лежит под ними, и не
 * спорят с содержимым. Сами названия документов — обычным шрифтом, серые, и
 * белеют под курсором: как все остальные нажимаемые слова в приложении.
 *
 * Ни плашек, ни рамок, ни знаков при ссылках. Прежние плитки были самым
 * заметным, что есть на странице ниже календаря, а документы читают раз в
 * жизни; и перечень по середине, который пришёл им на смену, вышел чужим —
 * весь остальной сайт выровнен по левому краю рамки, и единственная
 * центрированная колонка читалась как случайный остаток.
 *
 * Над всем этим — тонкая черта рамки (`border-rule`), та же, что у блоков
 * приложения.
 */

/** Почта для связи. */
export const EMAIL = "grafik1-3@yandex.ru";

/**
 * Документы сайта. Порядок — от общего к частному: на каких условиях
 * вообще, что с данными, на что человек согласился, чем управлять.
 *
 * Названия короче заголовков самих документов: «Политика в отношении
 * обработки персональных данных» в подвале занимает строку целиком, а
 * человек ищет глазами слово «политика».
 */
const ДОКУМЕНТЫ: readonly { href: string; label: string }[] = [
  { href: "/terms", label: "Пользовательское соглашение" },
  { href: "/privacy", label: "Политика конфиденциальности" },
  { href: "/consent", label: "Согласие на обработку данных" },
  { href: "/cookies", label: "Настройки cookie" },
];

/**
 * Подпись колонки: тем же голосом, что подписи под цифрами в полосе итога
 * (`period-summary.tsx`, `CAPTION_MINOR`), но бледнее цифр, а не чернил
 * темы при четверти силы — это единственное, что говорит колонке, о чём
 * она, и читаться должна.
 */
const ПОДПИСЬ =
  "block font-display text-xs font-bold uppercase leading-4 tracking-wide text-ink-faint";

/** Ссылка подвала: серая, белеет под курсором и под фокусом с клавиатуры. */
const ССЫЛКА = cn(
  "rounded-xs text-ink-muted no-underline transition-colors hover:text-ink",
  "focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-4",
  "focus-visible:outline-ink",
);

/**
 * Подвал целиком, без внешней рамки: знак с названием, документы, адрес.
 *
 * `skeleton` рисует ту же разметку теми же классами, но костями вместо
 * слов: заглушка рабочего экрана (`workspace-skeleton.tsx`) не копирует
 * подвал, а берёт его, и высота совпадает до пикселя, а не подбирается
 * числом.
 */
export function FooterBody({ skeleton = false }: { skeleton?: boolean }) {
  // В заглушке ссылки — не ссылки: нажимать там нечего, а подчёркивание и
  // цвет под плашкой всё равно не видны.
  const текст = (содержимое: ReactNode) => (
    <BoneText skeleton={skeleton}>{содержимое}</BoneText>
  );

  return (
    <div
      // Три колонки с `lg`: знак слева, документы и адрес — правым краем.
      // Ниже — две: знак сверху на всю ширину, под ним документы и адрес. На
      // телефоне — одна. Просвет между колонками один, и он заметно больше
      // просвета строк: колонки читаются колонками, а не сплошным текстом.
      //
      // `items-start`: все колонки стоят от одной верхней линии. По
      // умолчанию ячейки растягиваются на высоту самой высокой (списка из
      // четырёх документов), и знак с названием, выровненный внутри своей
      // ячейки по середине, повисал на уровне второго-третьего документа —
      // подвал читался как несобранный.
      className="grid items-start gap-x-16 gap-y-8 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto]"
    >
      {/* Знак и название — та же пара, что в шапке (`site-header.tsx`),
          только приглушённая: знак одноцветный, название серое. Цифры
          графика — те же, что в шапке, и меняются вместе с ним. */}
      {skeleton ? (
        <div className="flex items-center gap-2.5 sm:col-span-2 lg:col-span-1">
          <Bone className="size-6 shrink-0 rounded-md" />
          <span className="font-display text-lg font-bold uppercase leading-tight tracking-wide">
            {текст("График 1|3")}
          </span>
        </div>
      ) : (
        <Link
          href="/"
          className={cn(
            "group flex w-fit items-center gap-2.5 sm:col-span-2 lg:col-span-1",
            // Цвет на самой ссылке: у `a` свой, синий по умолчанию, и он
            // перебивает цвет родителя у всего, что цвета не назначило.
            "rounded-xs text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-4",
            "focus-visible:outline-ink",
          )}
        >
          <Logo mono className="size-6 shrink-0 text-ink-faint" />
          <span className="font-display text-lg font-bold uppercase leading-tight tracking-wide whitespace-nowrap text-ink-muted transition-colors group-hover:text-ink">
            <span className="max-[399px]:sr-only">{"График "}</span>
            <ScheduleMark />
          </span>
        </Link>
      )}

      <nav aria-labelledby={skeleton ? undefined : "footer-documents"}>
        <h2 id={skeleton ? undefined : "footer-documents"} className={ПОДПИСЬ}>
          {текст("Документы")}
        </h2>
        <ul className="mt-3 space-y-2 text-sm leading-5">
          {ДОКУМЕНТЫ.map(({ href, label }) => (
            <li key={href}>
              {skeleton ? (
                текст(label)
              ) : (
                <Link href={href} className={ССЫЛКА}>
                  {label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </nav>

      <div>
        <p className={ПОДПИСЬ}>{текст("Вопросы и обращения")}</p>
        <p className="mt-3 text-sm leading-5">
          {skeleton ? (
            текст(EMAIL)
          ) : (
            <a
              href={`mailto:${EMAIL}`}
              // Адрес не переносится по дефису: разорванный на «grafik1-» и
              // «3@yandex.ru» он читается как два куска и не копируется
              // двойным нажатием.
              className={cn(ССЫЛКА, "whitespace-nowrap")}
            >
              {EMAIL}
            </a>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * Готовый подвал: черта рамки, оговорки страницы (`children`) — на
 * посадочной они над перечнем — и сам подвал (`FooterBody`).
 */
export function SiteFooter({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <footer className={cn("border-t border-rule", className)}>
      <div className="mx-auto w-full max-w-4xl space-y-10 px-6 py-10 xl:max-w-6xl 2xl:max-w-7xl">
        {children}
        <FooterBody />
      </div>
    </footer>
  );
}
