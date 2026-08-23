import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarCog,
  CalendarDays,
  ChevronDown,
  Plane,
  Scale,
  ShieldCheck,
  Siren,
  type LucideIcon,
} from "lucide-react";

import { LandingHero } from "@/components/landing/hero";
import { HeroCta } from "@/components/landing/hero-cta";
import { SiteHeader } from "@/components/shared/site-header";
import { ThemeToggle } from "@/components/ui/theme-toggle";

/**
 * Посадочная страница.
 *
 * --- Что она должна сделать -----------------------------------------------
 *
 * Человек приходит из поиска по запросу вроде «сняли 24 часа за смену в
 * отпуске». Ему нужно понять три вещи: его случай здесь назван, он
 * решается конкретной нормой, данные никуда не уходят. Всё остальное —
 * лишний экран между вопросом и ответом.
 *
 * --- Как устроен первый экран ---------------------------------------------
 *
 * Он общий с расчётом без профиля и живёт в `LandingHero`: слева слово,
 * справа месяц графика — не фон под словами, а предмет рядом с ними.
 * Отсюда сюда передаётся только кнопка: на посадочной она ведёт в расчёт,
 * а надпись на ней зависит от того, построен ли уже график (`HeroCta`).
 *
 * --- Почему сигнальный цвет в заголовке -----------------------------------
 *
 * Правило приложения — «сигнальный цвет не украшает»: в рабочих экранах он
 * появляется только там, где что-то требует решения. Здесь он взят как
 * ЗНАК, а не как сигнал: тот же красный, что в логотипе, и стоит он на том
 * слове, ради которого страницу открыли. Рабочих экранов это не касается.
 *
 * --- Почему это серверный компонент ---------------------------------------
 *
 * Ради поиска: страница отдаётся готовым HTML со всем текстом и разметкой
 * Schema.org. Сам расчёт живёт отдельным адресом и из выдачи исключён —
 * форма без объяснений там бесполезна.
 */

const NAME = "График 1 3";

/**
 * Почта для связи.
 *
 * Стоит в подвале открытым адресом, а не за формой: формы у сервиса нет и
 * не будет — она означала бы приём и хранение чужих данных, то есть ровно
 * то, чего здесь нет. Открытый адрес собирают спам-роботы, и это
 * известная плата; прятать его скриптом значило бы спрятать и от того,
 * кто читает страницу без сценариев.
 */
const EMAIL = "grafik1-3@yandex.ru";
const TITLE = "Норма и переработка при графике сутки через трое";
const DESCRIPTION =
  "График 1 3 на год: смены, отпуска, больничные, работа помимо графика и " +
  "заметки к дню. Норма считается по производственному календарю, " +
  "переработка — за учётный период. Расчёт идёт в браузере, без регистрации.";

export const metadata: Metadata = {
  // Название дописано руками: шаблон из корневой разметки на её же страницу
  // не распространяется, а узнаваемое имя в конце заголовка выдачи стоит
  // тех девяти знаков, которые занимает.
  title: `${TITLE} — ${NAME}`,
  description: DESCRIPTION,
  keywords: [
    "график сутки через трое",
    "График 1 3",
    "сутки через трое норма часов",
    "суммированный учёт рабочего времени",
    "калькулятор переработки при сменном графике",
    "минус 24 часа за отпуск",
    "норма часов при сменном графике",
    "учёт рабочего времени сменный график",
  ],
  openGraph: {
    title: `${TITLE} — ${NAME}`,
    description: DESCRIPTION,
    type: "website",
    locale: "ru_RU",
    siteName: NAME,
  },
  alternates: { canonical: "/" },
};

/** Что делает приложение. Шесть карточек, по одному предложению в каждой. */
const FEATURES: [Icon: LucideIcon, title: string, text: string][] = [
  [
    CalendarDays,
    "Автоматический график",
    "Укажите дату рабочей смены и график достроится сам, в обе стороны.",
  ],
  [
    Scale,
    "Норма периода",
    "40, 36 или 35 часов в неделю по производственному календарю.",
  ],
  [
    Plane,
    "Отпуска и больничные",
    "Отсутствие по уважительной причине вычитается из нормы и фактически отработанного времени.",
  ],
  [
    Siren,
    "Работа помимо графика",
    "Выходы сверх своих смен прибавляются к фактически отработанным часам.",
  ],
  [
    CalendarCog,
    "Редактируемый календарь",
    "При нажатии на день календаря можно указывать различные события необходимой продолжительности.",
  ],
  [
    ShieldCheck,
    "Данные в безопасности",
    "Расчёт идёт в браузере. Профиль хранится на устройстве с возможностью сохранения в файл.",
  ],
];

/** На чём стоит расчёт. Только то, что приложение действительно применяет. */
const SOURCES: [source: string, what: string, href: string][] = [
  [
    "Трудовой кодекс РФ",
    "Ст. 91, 92, 95, 99, 104, 108, 112, 152, 153: норма рабочего времени, сокращённая неделя, предпраздничные дни, суммированный учёт.",
    "https://base.garant.ru/12125268/",
  ],
  [
    "Приказ Минздравсоцразвития № 588н от 13.08.2009",
    "Формула нормы рабочего времени на месяц, квартал и год.",
    "https://normativ.kontur.ru/document?moduleId=1&documentId=143110",
  ],
  [
    "Письмо Роструда № 550-6-1 от 01.03.2010",
    "Уменьшение нормы учётного периода на часы отсутствия по уважительной причине.",
    "https://base.garant.ru/12182312/",
  ],
  [
    "Письмо Минздравсоцразвития № 22-2/377333-782 от 13.10.2011",
    "Случаи уменьшения нормы рабочего времени работника.",
    "https://base.garant.ru/55172417/",
  ],
  [
    "Производственные календари",
    "Рабочие, выходные и предпраздничные дни, переносы.",
    "https://www.consultant.ru/law/ref/calendar/",
  ],
];

/**
 * Вопросы для разметки поиска.
 *
 * Это то, о чём спорят с работодателем, и ответ на каждый — норма с
 * реквизитами. Такие ответы попадают в выдачу целиком и работают даже для
 * того, кто на сайт не зашёл.
 */
const FAQ: { question: string; answer: string }[] = [
  {
    question: "Законно ли снимать 24 часа за смену, попавшую в отпуск?",
    answer:
      "Нет. При суммированном учёте часы, пришедшиеся по графику на отпуск, " +
      "больничный или иное освобождение с сохранением места работы, уменьшают " +
      "норму учётного периода, а не фактически отработанное время. Если снять " +
      "их с факта, появляется недоработка за то время, когда человек был " +
      "освобождён от работы. Порядок разъяснён письмом Роструда № 550-6-1 от " +
      "01.03.2010.",
  },
  {
    question: "Какой учётный период применяется при графике «сутки через трое»?",
    answer:
      "Три месяца, полугодие или год — какой именно, устанавливает " +
      "работодатель правилами внутреннего трудового распорядка или " +
      "коллективным договором (ст. 104 ТК РФ). Переработка определяется по " +
      "итогу всего периода, а не сравнением одного месяца с его календарной " +
      "нормой.",
  },
  {
    question: "Как считается норма за учётный период?",
    answer:
      "Рабочие дни периода по производственному календарю умножаются на " +
      "недельную норму и делятся на пять; из результата вычитается по часу за " +
      "каждый предпраздничный день (ст. 95 и 104 ТК РФ, Приказ " +
      "Минздравсоцразвития № 588н).",
  },
  {
    question: "Куда попадают мои данные?",
    answer:
      "Никуда. Расчёт идёт в браузере, сервера у приложения нет. Профиль " +
      "хранится на устройстве и при необходимости сохраняется в файл самим пользователем. Проверить просто: " +
      "отключите интернет после загрузки — расчёт продолжит работать.",
  },
];

export default function LandingPage() {
  return (
    <>
      {/* Справа в шапке — выбор темы.
          -------------------------------------------------------------
          Здесь стояла кнопка «Открыть расчёт», и она была лишней: ровно
          та же дверь, только крупнее и с объяснением, стоит на первом
          экране в двух сантиметрах ниже. Две одинаковые кнопки в поле
          зрения заставляют выбирать между ними, хотя выбора нет.

          Тема же относится не к странице, а к окну, и своего места ни в
          одном разделе не имеет. В подвале она была — то есть за
          прокруткой всей страницы; человеку, которому режет глаза, идти
          туда через четыре экрана. */}
      <SiteHeader action={<ThemeToggle />} className="items-center" />

      <main className="mx-auto w-full max-w-4xl px-6 pb-16 xl:max-w-6xl 2xl:max-w-7xl">
        <LandingHero cta={<HeroCta />} />

        {/* --------------------------------------------------------- что делает */}
        <section aria-labelledby="what" className="space-y-5 border-b border-rule py-14">
          <h2 id="what" className="text-2xl md:text-4xl">
            Как работает
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(([Icon, title, text]) => (
              <li key={title} className="space-y-3 rounded-xl bg-paper-raised p-5">
                {/* Значки нейтральные. Шесть сигнальных плиток подряд
                    превратили бы красный в оформление, а он на этой
                    странице стоит ровно дважды: на слове в заголовке и на
                    чипе с тем, ради чего сюда пришли. */}
                <span className="flex size-10 items-center justify-center rounded-xl bg-paper-sunken">
                  <Icon aria-hidden className="size-5 text-ink-muted" />
                </span>
                <h3 className="font-display text-base font-bold uppercase tracking-wide">
                  {title}
                </h3>
                <p className="text-sm text-ink-muted">{text}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------------------------------------ основания */}
        <section aria-labelledby="law" className="space-y-5 border-b border-rule py-14">
          <h2 id="law" className="text-2xl md:text-4xl">
            Полезно знать
          </h2>
          <dl className="grid gap-x-10 gap-y-4 sm:grid-cols-2">
            {SOURCES.map(([source, what, href]) => (
              <div key={source} className="group space-y-0.5">
                <dt className="text-sm font-medium">
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-ink group-hover:underline"
                  >
                    {source}
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      width="12"
                      height="12"
                      className="shrink-0 text-ink-muted"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                </dt>
                <dd className="text-sm text-ink-muted">{what}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ---------------------------------------------------------------- вопросы */}
        <section aria-labelledby="faq" className="space-y-5 py-14">
          <h2 id="faq" className="text-2xl md:text-4xl">
            Частые вопросы
          </h2>
          <div className="grid gap-2">
            {FAQ.map((item) => (
              <details
                key={item.question}
                className="group rounded-xl bg-paper-raised px-5"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 text-sm font-medium marker:hidden md:text-md">
                  <span>{item.question}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-5 shrink-0 text-ink-muted transition-transform duration-200 group-open:rotate-180"
                  />
                </summary>
                <p className="pb-4 pr-8 text-sm leading-6 text-ink-muted md:text-md">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </section>

      </main>

      <footer className="mt-16 border-t border-rule">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8 sm:flex-row sm:items-end sm:justify-between xl:max-w-6xl 2xl:max-w-7xl">
          <div className="max-w-prose space-y-2 text-xs text-ink-muted">
            <p>
              {NAME} не заменяет табель или другие документы работодателя.
              Приложение показывает, как норма и переработка получаются из
              производственного календаря и вашего графика.
            </p>
            <p>
              Точность зависит от введённого: даты смены, недельной нормы и
              периодов отсутствия.
            </p>
            {/* Условия, раздел о данных и почта — одной строкой. Это не
                навигация, а ответ на три вопроса, которые сервис вызывает
                у всех: на каких условиях, что с моими данными и кому
                написать, если число посчиталось неверно. */}
            <p className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
              <Link href="/terms" className="text-ink-muted hover:underline">
                Условия использования
              </Link>
              <Link href="/terms#data" className="text-ink-muted hover:underline">
                Данные и приватность
              </Link>
              <a href={`mailto:${EMAIL}`} className="text-ink-muted hover:underline">
                {EMAIL}
              </a>
            </p>
          </div>
        </div>
      </footer>

      {/* Разметка для поиска. Тот же текст, что и на странице: ответы,
          расходящиеся с видимым содержимым, поисковики считают обманом. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "WebApplication",
                name: NAME,
                alternateName: TITLE,
                description: DESCRIPTION,
                applicationCategory: "BusinessApplication",
                operatingSystem: "Любая, в браузере",
                inLanguage: "ru-RU",
                isAccessibleForFree: true,
                offers: { "@type": "Offer", price: "0", priceCurrency: "RUB" },
                featureList: FEATURES.map(([, title, text]) => `${title}: ${text}`),
              },
              {
                "@type": "FAQPage",
                mainEntity: FAQ.map((item) => ({
                  "@type": "Question",
                  name: item.question,
                  acceptedAnswer: { "@type": "Answer", text: item.answer },
                })),
              },
            ],
          }),
        }}
      />
    </>
  );
}
