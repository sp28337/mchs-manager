import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { SiteHeader } from "@/components/shared/site-header";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils/cn";

/**
 * Посадочная страница.
 *
 * --- Что она должна сделать -----------------------------------------------
 *
 * Человек приходит из поиска по запросу вроде «пожарным ставят минус 24
 * часа за отпуск». Ему нужно понять три вещи: его случай здесь назван, он
 * решается конкретной нормой, данные никуда не уходят. Всё остальное —
 * лишний экран между вопросом и ответом.
 *
 * --- Почему первый экран — снимок расчёта ---------------------------------
 *
 * Раньше фоном чертился нарисованный табель: красиво и ничего не говорит о
 * продукте. Теперь на фоне сам продукт — снимок годовой сетки, наклонённый
 * и растворённый по краям (`.hero-shot` в `globals.css`). Числа в нём не
 * читаются намеренно: их читают в расчёте.
 *
 * --- Почему это серверный компонент ---------------------------------------
 *
 * Ради поиска: страница отдаётся готовым HTML со всем текстом и разметкой
 * Schema.org. Сам расчёт живёт отдельным адресом и из выдачи исключён —
 * форма без объяснений там бесполезна.
 */

const NAME = "График 1/3";
const TITLE = "Калькулятор переработки: сутки через трое";
const DESCRIPTION =
  "Норма и переработка при графике сутки через трое: график караула на год, " +
  "производственный календарь, отпуска и больничные. Расчёт идёт в браузере, " +
  "без регистрации.";

export const metadata: Metadata = {
  // Название дописано руками: шаблон из корневой разметки на её же страницу
  // не распространяется, а узнаваемое имя в конце заголовка выдачи стоит
  // тех девяти знаков, которые занимает.
  title: `${TITLE} — ${NAME}`,
  description: DESCRIPTION,
  keywords: [
    "калькулятор переработки пожарных",
    "сутки через трое норма часов",
    "суммированный учёт рабочего времени",
    "минус 24 часа за отпуск",
    "норма часов при сменном графике",
    "переработка МЧС",
    "график караула сутки через трое",
    "приказ 307 приказ 308 МЧС",
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

/** Числа первого экрана: настоящий расчёт за 2026 год, 1-й караул. */
const SAMPLE: [value: string, caption: string, verify?: boolean][] = [
  ["1972 ч", "Норма"],
  ["2192 ч", "Фактически"],
  ["220 ч", "Переработка", true],
];

/** Что делает приложение. По одному-двум предложениям на пункт. */
const WHAT: [title: string, text: string][] = [
  [
    "Строит график караула",
    "Номер караула и одна ваша смена — хоть завтрашняя. Цикл четырёхдневный, поэтому от одной даты год достраивается в обе стороны.",
  ],
  [
    "Считает норму периода",
    "40, 36 или 35 часов в неделю по производственному календарю, минус час за каждый предпраздничный день. Календарь правится по дням.",
  ],
  [
    "Учитывает отсутствия",
    "Отпуск, больничный и учебный отпуск уменьшают норму, отгул за переработку — нет. Соревнования, сборы и резерв прибавляются к отработанному.",
  ],
  [
    "Показывает итог",
    "Норма, факт и переработка за квартал, полугодие или год. Ночные и праздничные часы — отдельными числами, переработка в часах или сменах.",
  ],
];

/** На чём стоит расчёт. Только то, что приложение действительно применяет. */
const SOURCES: [source: string, what: string, href: string][] = [
  [
    "Федеральный закон № 141-ФЗ от 23.05.2016",
    "Служебное время сотрудника ФПС ГПС и порядок его учёта (ст. 54, 55).",
    "https://base.garant.ru/71403774/",
  ],
  [
    "Трудовой кодекс РФ",
    "Ст. 91, 92, 95, 99, 104, 108, 112, 152, 153: норма рабочего времени, сокращённая неделя, предпраздничные дни, суммированный учёт.",
    "https://base.garant.ru/12125268/",
  ],
  [
    "Приказ МЧС России № 308 от 24.04.2026",
    "Сотрудники ФПС ГПС: продолжительность служебного времени, учётный период, 24-часовая смена.",
    "https://base.garant.ru/414319430/",
  ],
  [
    "Приказ МЧС России № 307 от 24.04.2026",
    "Работники без специальных званий: недельная норма 40, 36 или 35 часов и учётный период.",
    "https://base.garant.ru/414325735/",
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
    "Приказ МЧС России № 410 от 24.09.2018",
    "Ночные, выходные и праздничные часы в пределах нормы переработкой не становятся (п. 14).",
    "https://base.garant.ru/72115220/",
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
 * Это то, что спрашивают у начальника караула, и ответ на каждый — норма с
 * реквизитами. Такие ответы попадают в выдачу целиком и работают даже для
 * того, кто на сайт не зашёл.
 */
const FAQ: { question: string; answer: string }[] = [
  {
    question: "Законно ли снимать 24 часа за смену, попавшую в отпуск?",
    answer:
      "Нет. При суммированном учёте часы, пришедшиеся по графику на отпуск, " +
      "больничный или иное освобождение с сохранением места службы, уменьшают " +
      "норму учётного периода, а не фактически отработанное время. Если снять " +
      "их с факта, появляется недоработка за то время, когда человек был " +
      "освобождён от службы. Порядок разъяснён письмом Роструда № 550-6-1 от " +
      "01.03.2010.",
  },
  {
    question: "Сколько часов в неделю должен работать пожарный?",
    answer:
      "Общая норма — 40 часов. Сокращённая бывает двух видов: 36 часов при " +
      "вредных 3-4 степени либо опасных условиях по спецоценке (Приказ МЧС " +
      "России № 308 п. 1, № 307 п. 6) и при работе в районах Крайнего Севера и " +
      "приравненных к ним местностях (№ 308 п. 1, № 307 п. 4); 35 часов — при " +
      "инвалидности I или II группы (абз. 4 ч. 1 ст. 92 ТК РФ). Основания не " +
      "складываются: два по 36 часов дают 36, а не 32.",
  },
  {
    question: "Какой учётный период применяется при графике «сутки через трое»?",
    answer:
      "Три месяца, полугодие или год — какой именно, устанавливает " +
      "подразделение (ст. 104 ТК РФ, Приказ МЧС России № 308 п. 2, № 307 п. 7). " +
      "Переработка определяется по итогу всего периода, а не сравнением одного " +
      "месяца с его календарной нормой.",
  },
  {
    question: "Как считается норма за учётный период?",
    answer:
      "Рабочие дни периода по производственному календарю умножаются на " +
      "недельную норму и делятся на пять; из результата вычитается по часу за " +
      "каждый предпраздничный день (ст. 95 и 104 ТК РФ, Приказ " +
      "Минздравсоцразвития № 588н). Число смен и номер караула на норму не " +
      "влияют.",
  },
  {
    question: "Ночные и праздничные часы — это переработка?",
    answer:
      "Сами по себе нет. В пределах нормы они учитываются как отработанное " +
      "время, но сверхурочной работы не создают и дополнительным отдыхом при " +
      "суммированном учёте не компенсируются (Приказ МЧС России № 410 от " +
      "24.09.2018, п. 14). В расчёте они показаны отдельными числами.",
  },
  {
    question: "Куда попадают мои данные?",
    answer:
      "Никуда. Расчёт идёт в браузере, сервера у приложения нет. Профиль " +
      "хранится на устройстве и выгружается в файл. Проверить просто: " +
      "отключите интернет после загрузки — расчёт продолжит работать.",
  },
];

export default function LandingPage() {
  return (
    <>
      <SiteHeader
        action={
          <ToCalculator size="sm">
            {/* На 320 точках «Открыть расчёт» вместе со знаком не помещается,
                и название переносится на вторую строку. Слово короче — но
                всё же слово: значок без подписи здесь ничего не называет. */}
            <span className="xxs:hidden">Расчёт</span>
            <span className="hidden xxs:inline">Открыть расчёт</span>
          </ToCalculator>
        }
      />

      <main className="mx-auto w-full max-w-4xl px-6 pb-16 xl:max-w-6xl 2xl:max-w-7xl">
        {/* ------------------------------------------------------ первый экран */}
        {/* `hero-band` (в `globals.css`) выводит экран за колонку `main` —
            ровно настолько, насколько это не съедает поле у края окна.
            `isolate` держит слои внутри: снимок лежит под текстом и не
            спорит ни с шапкой, ни со страницей. */}
        <section className="hero-band relative isolate flex min-h-[86lvh] flex-col justify-center border-b border-rule pt-15">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
            {/* Снимок расчёта, а не рисунок: человек видит то, что получит.
                Две темы — два файла: перекрасить снимок фильтрами дороже и
                грязнее, чем снять его дважды. */}
            {/* Обычный `img`, а не `next/image`: при статическом экспорте
                оптимизатор всё равно отключается, и обёртка добавила бы
                конфиг и разметку, ничего не дав взамен. Размеры заданы
                явно — место под снимок занято до его загрузки. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/hero-grid-dark.webp"
              alt=""
              width={1600}
              height={977}
              className="hero-shot hidden max-w-none dark:block"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/hero-grid-light.webp"
              alt=""
              width={1600}
              height={977}
              className="hero-shot max-w-none dark:hidden"
            />
          </div>

          <div className="space-y-7">
            <p className="font-mono text-xs uppercase tracking-widest text-ink-faint">
              Сутки через трое
            </p>

            <h1 className="max-w-3xl text-3xl leading-[1.1] sm:text-5xl lg:text-6xl">
              Переработка при графике сутки через трое
            </h1>

            <p className="max-w-md text-lg text-ink-muted sm:max-w-xl">
              Норма по производственному календарю. Отпуск уменьшает норму, а не
              отработанные часы.
            </p>

            {/* Три числа в том же виде, что и в расчёте: первый экран
                показывает результат, а не обещает его. */}
            <div className="space-y-2">
              <dl className="flex flex-wrap gap-2">
                {SAMPLE.map(([value, caption, verify]) => (
                  <div
                    key={caption}
                    className="min-w-28 rounded-xl bg-paper-raised px-4 py-2.5"
                  >
                    <dd
                      className={cn(
                        "font-mono text-xl leading-none sm:text-2xl",
                        verify ? "font-medium text-verify" : "text-ink",
                      )}
                    >
                      {value}
                    </dd>
                    <dt className="mt-1.5 text-[11px] leading-tight text-ink-muted">
                      {caption}
                    </dt>
                  </div>
                ))}
              </dl>
              <p className="font-mono text-xs text-ink-faint">
                1-й караул, 2026 год, 40-часовая неделя
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-1">
              <ToCalculator>Открыть калькулятор</ToCalculator>
              <p className="text-sm text-ink-muted">Бесплатно, без регистрации</p>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- минус 24 */}
        <section aria-labelledby="minus" className="space-y-5 border-b border-rule py-14">
          <h2 id="minus" className="text-2xl md:text-4xl">
            Откуда берётся недоработка, которой нет
          </h2>
          <p className="max-w-prose text-ink-muted">
            Смена, попавшая в отпуск, вычитается из нормы периода. Если вычесть её
            из отработанного, число будет то же, а итог — противоположный.
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1 rounded-xl bg-signal-soft p-5">
              <p className="font-display text-xs font-bold uppercase tracking-wide text-signal">
                Вычли из факта
              </p>
              <p className="font-mono text-sm">норма 168 ч</p>
              <p className="font-mono text-sm">факт 168 − 24 = 144 ч</p>
              <p className="pt-1 text-sm font-semibold">Недоработка 24 ч</p>
            </div>
            <div className="space-y-1 rounded-xl bg-verify-soft p-5">
              <p className="font-display text-xs font-bold uppercase tracking-wide text-verify">
                Вычли из нормы
              </p>
              <p className="font-mono text-sm">норма 168 − 24 = 144 ч</p>
              <p className="font-mono text-sm">факт 144 ч</p>
              <p className="pt-1 text-sm font-semibold">Ровно норма</p>
            </div>
          </div>

          <p className="max-w-prose text-sm text-ink-muted">
            Основание — письмо Роструда № 550-6-1 от 01.03.2010: часы, которые
            человек не должен был отрабатывать по уважительной причине,
            исключаются из нормы учётного периода.
          </p>
        </section>

        {/* --------------------------------------------------------- что делает */}
        <section aria-labelledby="what" className="space-y-5 border-b border-rule py-14">
          <h2 id="what" className="text-2xl md:text-4xl">
            Что делает приложение
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {WHAT.map(([title, text]) => (
              <li key={title} className="space-y-1.5 rounded-xl bg-paper-raised p-5">
                <h3 className="font-display text-base font-bold uppercase tracking-wide">
                  {title}
                </h3>
                <p className="text-sm text-ink-muted">{text}</p>
              </li>
            ))}
          </ul>
          <p className="max-w-prose text-sm text-ink-muted">
            Сверять итог с выданным табелем вы будете сами: приложение даёт число
            и норму, по которой оно получено.
          </p>
        </section>

        {/* ------------------------------------------------------------ основания */}
        <section aria-labelledby="law" className="space-y-5 border-b border-rule py-14">
          <h2 id="law" className="text-2xl md:text-4xl">
            На чём основан расчёт
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

        {/* --------------------------------------------------------------- в расчёт */}
        <section className="flex flex-col items-start gap-6 rounded-xl bg-paper-raised p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10">
          <div className="space-y-2">
            <h2 className="text-2xl md:text-3xl">Посмотрите свой год</h2>
            <p className="max-w-prose text-ink-muted">
              Три ответа: караул, ваша смена и недельная норма. График на год
              построится сразу.
            </p>
          </div>
          <ToCalculator>Открыть калькулятор</ToCalculator>
        </section>
      </main>

      <footer className="mt-16 border-t border-rule">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8 sm:flex-row sm:items-end sm:justify-between xl:max-w-6xl 2xl:max-w-7xl">
          <div className="max-w-prose space-y-2 text-xs text-ink-muted">
            <p>
              {NAME} — не официальный сервис МЧС России и не заменяет табель или
              другие документы работодателя. Приложение показывает, как норма и
              переработка получаются из производственного календаря и вашего
              графика.
            </p>
            <p>
              Точность зависит от введённого: караула, даты смены, недельной нормы
              и периодов отсутствия.
            </p>
          </div>
          <ThemeToggle />
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
                featureList: [
                  "График караула сутки через трое на год от одной известной смены",
                  "Норма учётного периода по производственному календарю",
                  "Производственный календарь с правкой по дням",
                  "Исключение отпусков и больничных из нормы",
                  "Ночные и праздничные часы отдельным итогом",
                  "Переработка в часах или сменах",
                ],
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

/**
 * Кнопка в расчёт. Одна на всю страницу: их здесь три, и разъехаться
 * подписью или размером им нельзя.
 */
function ToCalculator({
  children,
  size = "md",
}: {
  children: React.ReactNode;
  size?: "sm" | "md";
}) {
  return (
    <Link
      href="/calculator"
      className={cn(
        "inline-flex shrink-0 items-center rounded-xl bg-ink font-bold text-paper no-underline",
        "hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace",
        size === "sm" ? "h-9 px-4 text-sm" : "h-11 px-6 text-base",
      )}
    >
      {children}
    </Link>
  );
}
