import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { SiteHeader } from "@/components/shared/site-header";
import { TabelBackdrop } from "@/components/shared/tabel-backdrop";
import { Logo } from "@/components/ui/logo";
import { Calculator, ChevronDown } from "lucide-react";

/**
 * Посадочная страница.
 *
 * --- Что она должна сделать за десять секунд ----------------------------
 *
 * Человек приходит сюда из поиска по запросу вроде «пожарным ставят минус
 * 24 часа за отпуск». Ему нужно понять три вещи, и в таком порядке:
 * его проблема здесь названа; она решается конкретной нормой; его данные
 * никуда не уйдут. Только после этого имеет смысл звать в приложение.
 *
 * --- Почему это серверный компонент -------------------------------------
 *
 * Ради поиска. Страница отдаётся готовым HTML со всем текстом и разметкой
 * Schema.org; сам расчёт с его `localStorage` живёт отдельным адресом и
 * из выдачи исключён — пустая форма без объяснений там бесполезна.
 *
 * --- Почему нет отзывов, счётчиков и «нам доверяют» ---------------------
 *
 * Инструмент существует, чтобы спорить с работодателем документами.
 * Страница, которая уговаривает вместо того, чтобы приводить нормы, — это
 * ровно та интонация, из-за которой ему и не поверят в кабинете.
 *
 * --- Почему обещано ровно то, что есть ----------------------------------
 *
 * Раньше здесь стояли сверка с выданным табелем и расчёт денег — этого в
 * приложении больше нет. Обещание, не подтверждённое экраном, стоит
 * дороже любого текста: человек уходит не с «не нашёл функцию», а с «мне
 * соврали».
 */

const NAME = "График 1/3";
const TITLE = "Калькулятор переработки: сутки через трое";
const DESCRIPTION =
  "Норма и переработка при графике сутки через трое: график караула на год, " +
  "производственный календарь, отпуска и больничные. Расчёт идёт в браузере, " +
  "без регистрации.";

export const metadata: Metadata = {
  // Название дописано руками: шаблон из корневой разметки на её же
  // страницу не распространяется, а узнаваемое имя в конце заголовка
  // выдачи стоит тех девяти знаков, которые оно занимает.
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

/**
 * Разметка для поиска.
 *
 * Вопросы взяты не из головы: это то, что спрашивают в кабинете у
 * начальника, и ответ на каждый — норма с реквизитами. Такие ответы
 * попадают в выдачу целиком, а значит, работают даже для того, кто на
 * сайт не зашёл.
 */
const FAQ: { question: string; answer: string }[] = [
  {
    question:
      "Законно ли снимать 24 часа за смену, попавшую в отпуск или больничный?",
    answer:
      "Нет. При суммированном учёте часы, которые по графику пришлись на отпуск, " +
      "больничный или иное освобождение с сохранением места службы, уменьшают " +
      "НОРМУ учётного периода, а не фактически отработанное время. Если снять их " +
      "с факта, получится парадокс: человек был освобождён от службы, а часы " +
      "превратились в его недоработку. Порядок разъяснён письмом Роструда " +
      "№ 550-6-1 от 01.03.2010.",
  },
  {
    question: "Сколько часов в неделю должен работать пожарный?",
    answer:
      "Общая норма — 40 часов. Сокращённая продолжительность бывает двух видов: " +
      "36 часов при вредных 3-4 степени либо опасных условиях по спецоценке " +
      "(Приказ МЧС России № 308 п. 1, № 307 п. 6) и при работе в районах " +
      "Крайнего Севера и приравненных к ним местностях (№ 308 п. 1, № 307 п. 4); " +
      "35 часов — при инвалидности I или II группы (абз. 4 ч. 1 ст. 92 ТК РФ). " +
      "Основания не складываются: два по 36 часов дают 36, а не 32.",
  },
  {
    question: "Какой учётный период применяется при графике «сутки через трое»?",
    answer:
      "Сам график не означает, что переработку надо искать в каждом месяце. " +
      "Учётный период при суммированном учёте — три месяца, полугодие или год " +
      "(ст. 104 ТК РФ, Приказ МЧС России № 308 п. 2, № 307 п. 7); какой именно, " +
      "устанавливает подразделение. Переработка определяется по его окончании, а " +
      "не сравнением одного месяца с его календарной нормой.",
  },
  {
    question: "Как считается норма за учётный период?",
    answer:
      "От производственного календаря, а не от числа смен: рабочие дни периода " +
      "умножаются на недельную норму и делятся на пять, из результата вычитается " +
      "по часу за каждый предпраздничный день (ст. 95 и 104 ТК РФ, Приказ " +
      "Минздравсоцразвития № 588н). Номер караула на норму не влияет — он влияет " +
      "только на то, в какие сутки человек заступал.",
  },
  {
    question: "Ночные и праздничные часы — это переработка?",
    answer:
      "Сами по себе нет. В пределах нормы они учитываются как отработанное время, " +
      "но сверхурочной работы не создают, и дополнительным отдыхом при " +
      "суммированном учёте не компенсируются (Приказ МЧС России № 410 от " +
      "24.09.2018, п. 14). Приложение показывает их отдельным числом — как факт, " +
      "который может пригодиться в разговоре, — но в переработку не превращает.",
  },
  {
    question: "Куда попадают мои данные?",
    answer:
      "Никуда. Расчёт идёт в вашем браузере, сервера у приложения нет: ни " +
      "профиль, ни сведения о больничных и инвалидности наружу не отправляются. " +
      "Проверить просто — отключите интернет после загрузки страницы, расчёт " +
      "продолжит работать.",
  },
];

/** Что человек делает и что получает в ответ. */
const STEPS = [
  {
    title: "График караула",
    text:
      "Назовите номер караула и любую свою смену — хоть завтрашнюю. Цикл " +
      "четырёхдневный, поэтому от одной даты приложение достраивает год в обе " +
      "стороны: и вперёд, и назад.",
  },
  {
    title: "Норма периода",
    text:
      "40, 36 или 35 часов в неделю — по вашему основанию, и приложение назовёт " +
      "при нём пункт приказа. Норма считается по производственному календарю; " +
      "сам календарь можно править по дням — переносы бывают спорными.",
  },
  {
    title: "Отпуска и вызовы",
    text:
      "Отмечаются нажатием по дню. Отпуск, больничный и учебный отпуск уменьшают " +
      "норму, отгул за переработку — нет: он ею уже погашен. Соревнования, сборы, " +
      "резерв, мероприятия и выборы прибавляются к отработанному.",
  },
  {
    title: "Итог за период",
    text:
      "Квартал, полугодие или год, а внутри — любой месяц. Норма, факт и " +
      "переработка; отдельно ночные и праздничные часы, смены по графику и " +
      "пропущенные. Переработку видно в часах или сменами.",
  },
];

/** На чём стоит расчёт. Только то, что приложение действительно применяет. */
const SOURCES: [source: string, what: string, href: string][] = [
  [
    "Федеральный закон № 141-ФЗ от 23.05.2016",
    "Служба в федеральной противопожарной службе: служебное время и порядок его учёта (ст. 54, 55).",
    "https://base.garant.ru/71403774/",
  ],
  [
    "Трудовой кодекс Российской Федерации",
    "Ст. 91, 92, 95, 99, 104, 108, 112, 152, 153 — продолжительность рабочего времени, сокращённая неделя, предпраздничные дни, сверхурочная работа и суммированный учёт.",
    "https://base.garant.ru/12125268/",
  ],
  [
    "Приказ МЧС России № 308 от 24.04.2026",
    "Сотрудники ФПС ГПС: продолжительность служебного времени, учётный период, сменное дежурство и 24-часовая смена.",
    "https://base.garant.ru/414319430/",
  ],
  [
    "Приказ МЧС России № 307 от 24.04.2026",
    "Работники без специальных званий: недельная норма 40, 36 или 35 часов, учётный период и перерывы для отдыха.",
    "https://base.garant.ru/414325735/",
  ],
  [
    "Приказ Минздравсоцразвития № 588н от 13.08.2009",
    "Порядок исчисления нормы рабочего времени на месяц, квартал и год — та самая формула, по которой считается норма периода.",
    "https://normativ.kontur.ru/document?moduleId=1&documentId=143110",
  ],
  [
    "Письмо Роструда № 550-6-1 от 01.03.2010",
    "Как уменьшать норму учётного периода на часы, которые человек не должен был отрабатывать по уважительной причине.",
    "https://base.garant.ru/12182312/",
  ],
  [
    "Письмо Минздравсоцразвития № 22-2/377333-782 от 13.10.2011",
    "О случаях уменьшения нормы рабочего времени работника.",
    "https://base.garant.ru/55172417/",
  ],
  [
    "Приказ МЧС России № 410 от 24.09.2018",
    "Компенсация за службу в ночное время, выходные и праздничные дни: в пределах нормы такие часы не становятся переработкой (п. 14).",
    "https://base.garant.ru/72115220/",
  ],
  [
    "Производственные календари",
    "Рабочие, выходные и предпраздничные дни, переносы — то, от чего считается норма любого периода.",
    "https://www.consultant.ru/law/ref/calendar/",
  ],
];

export default function LandingPage() {
  return (
    <>
      <SiteHeader
        action={
          <Link
            href="/calculator"
            className="font-semibold inline-flex gap-2 h-9 items-center rounded-xl bg-ink px-4 text-sm text-paper hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace no-underline"
          >
            <span className="hidden xxs:block">Калькулятор</span>
            <span className="xxs:hidden">
              <Calculator className="size-5" />
            </span>
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-4xl px-6 pb-16 xl:max-w-6xl 2xl:max-w-7xl">
        {/* ------------------------------------------------------ первый экран */}
        {/* `hero-band` (в `globals.css`) выводит первый экран за колонку
            `main` — ровно настолько, насколько это не съедает поле у края
            окна. Вместе с полосой выходят все три вещи, которые обязаны
            стоять по одной вертикали: заголовок, линия под экраном и правый
            край фонового табеля. Ниже `xl` запаса нет, и полоса совпадает
            с колонкой.

            `isolate` — чтобы `z-index` слоёв не спорил ни с шапкой, ни с
            остальной страницей. Обрезки здесь нет намеренно: ниже `xl`
            табель уходит за край окна, а срезает его `overflow-x: clip` в
            корневой разметке. */}
        <section className="hero-band relative isolate flex h-lvh flex-col justify-center border-b border-rule pt-15 md:h-[90lvh]">
          <TabelBackdrop />

          <div className="relative z-10 space-y-6">
            <p className="font-mono text-xs uppercase tracking-widest text-ink-faint">
              Сотрудникам ФПС ГПС и работникам по договору
            </p>
            <h1 className="max-w-3xl text-2xl leading-[1.15] md:text-4xl sm:text-5xl lg:text-6xl">
              Переработка при графике сутки через трое
            </h1>
            <p className="max-w-prose text-lg text-ink-muted">
              Калькулятор восстанавливает график вашего караула на год, считает
              норму учётного периода по производственному календарю и показывает
              переработку — вместе с пунктом приказа, которым её можно
              подтвердить.
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Link
                href="/calculator"
                className="inline-flex h-11 items-center rounded-xl bg-ink px-6 text-base font-bold text-paper hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace"
              >
                Открыть калькулятор
              </Link>
              <p className="text-sm text-ink-muted">
                Бесплатно, без регистрации. Данные не покидают браузер.
              </p>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- сама проблема */}
        <section aria-labelledby="problem" className="space-y-4 border-b border-rule py-12">
          <h2 id="problem" className="text-2xl md:text-4xl">
            Отпуск уменьшает норму, а не отработанные часы
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            <p className="max-w-prose">
              При суммированном учёте часы, которые по графику пришлись на отпуск,
              больничный или другое освобождение с сохранением места службы,{" "}
              <strong>исключаются из нормы</strong> учётного периода. Фактически
              отработанное при этом не трогают.
            </p>
            <p className="max-w-prose text-ink-muted">
              Отсюда и самая частая ошибка в табеле: те же 24 часа снимают не с
              нормы, а с факта. Число одно и то же, но в первом случае у человека
              всё сходится, а во втором появляется недоработка, которой не было.
            </p>
          </div>

          <div className="mt-2 grid gap-px overflow-hidden rounded-xl border border-rule bg-rule sm:grid-cols-2">
            <div className="space-y-1 bg-signal-soft p-4">
              <p className="font-display text-xs font-bold uppercase tracking-wide text-signal">
                Как считают неправильно
              </p>
              <p className="font-mono text-sm">норма 168 ч</p>
              <p className="font-mono text-sm">факт 168 ч − 24 ч = 144 ч</p>
              <p className="text-sm font-semibold">Недоработка 24 ч</p>
            </div>
            <div className="space-y-1 bg-verify-soft p-4">
              <p className="font-display text-xs font-bold uppercase tracking-wide text-verify">
                Как должно быть
              </p>
              <p className="font-mono text-sm">норма 168 ч − 24 ч = 144 ч</p>
              <p className="font-mono text-sm">факт 144 ч</p>
              <p className="text-sm font-semibold">Всё сходится</p>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- как работает */}
        <section aria-labelledby="how" className="space-y-6 border-b border-rule py-12">
          <h2 id="how" className="text-2xl md:text-4xl">
            Что нужно ответить и что получится
          </h2>
          <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="space-y-2 rounded-xl bg-paper-raised p-5"
              >
                <p className="font-mono text-2xl leading-none text-ink-faint">
                  {index + 1}
                </p>
                <h3 className="font-display text-base font-bold uppercase tracking-wide">
                  {step.title}
                </h3>
                <p className="text-sm text-ink-muted">{step.text}</p>
              </li>
            ))}
          </ol>
          <p className="max-w-prose text-sm text-ink-muted">
            Сверять итог с выданным табелем человек будет сам: приложение даёт
            число и норму, по которой оно получено, — то, с чем можно прийти к
            начальнику караула.
          </p>
        </section>

        {/* --------------------------------------------------------------- нормы */}
        <section aria-labelledby="law" className="space-y-4 border-b border-rule py-12">
          <h2 id="law" className="text-2xl md:text-4xl">
            Расчёт, который можно проверить
          </h2>
          <p className="max-w-prose text-ink-muted">
            У каждого числа есть основание: продолжительность смены, недельная
            норма, порядок исчисления нормы периода, исключение часов за отпуск.
            Приложение показывает его рядом с числом, а полный список — здесь.
          </p>
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
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

        {/* ------------------------------------------------------------ приватность */}
        <section aria-labelledby="privacy" className="space-y-3 border-b border-rule py-12">
          <h2 id="privacy" className="text-2xl md:text-4xl">
            Данные остаются у вас
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            <p className="max-w-prose">
              Для расчёта нужны больничные, иногда — инвалидность. Это сведения о
              здоровье, и отправлять их наружу означало бы ровно тот риск, от
              которого человек сюда и пришёл.
            </p>
            <p className="max-w-prose text-ink-muted">
              Поэтому сервера у приложения нет: расчёт идёт в браузере, профиль
              хранится на устройстве. Браузеры чистят кэш — на этот случай профиль
              сохраняется в файл и возвращается из него целиком, вместе с
              внесёнными отпусками.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- вопросы */}
        <section aria-labelledby="faq" className="space-y-4 py-12">
          <h2 id="faq" className="text-2xl md:text-4xl">
            Частые вопросы
          </h2>

          <div className="grid gap-2">
            {FAQ.map((item) => (
              <details
                key={item.question}
                className="group rounded-xl bg-paper-raised px-4"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-3.5 text-sm font-medium marker:hidden md:text-md">
                  <span>{item.question}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-5 shrink-0 text-ink-muted transition-transform duration-200 group-open:rotate-180"
                  />
                </summary>

                <div className="pb-4 pr-10">
                  <p className="text-sm leading-6 text-ink-muted md:text-md">
                    {item.answer}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------------- ещё раз CTA */}
        <section className="space-y-4 py-14 text-center">
          <Logo className="mx-auto size-10 text-signal" />
          <h2 className="text-2xl md:text-4xl">Посмотрите свой год</h2>
          <p className="mx-auto max-w-prose text-ink-muted">
            Три ответа — караул, ваша смена и недельная норма, — и график на год
            готов. Дальше отмечаете отпуска и смотрите, сколько часов набежало
            сверх нормы.
          </p>
          <Link
            href="/calculator"
            className="inline-flex h-11 items-center rounded-xl bg-ink px-6 text-base font-bold text-paper hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace"
          >
            Открыть калькулятор
          </Link>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="flex flex-col items-end gap-10 px-6 py-8 md:flex-row">
          <div className="mx-auto w-full max-w-4xl space-y-2 text-xs text-ink-muted xl:max-w-5xl">
            <p className="max-w-prose">
              {NAME} — не официальный сервис МЧС России и не заменяет табель или
              иные документы работодателя. Приложение показывает, как норма и
              переработка получаются из производственного календаря и вашего
              графика, чтобы вы могли сравнить это с тем, что выдали вам.
            </p>
            <p className="max-w-prose">
              Точность зависит от введённого. Перед разговором проверьте, верно ли
              указаны караул, дата вашей смены, недельная норма и периоды
              отсутствия.
            </p>
          </div>
          <div className="mx-auto">
            <ThemeToggle />
          </div>
        </div>
      </footer>

      {/* Разметка для поиска. Тот же текст, что и на странице: ответы,
          расходящиеся с видимым содержимым, поисковики считают обманом — и
          справедливо. */}
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
