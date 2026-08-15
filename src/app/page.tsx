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
 * никуда не уйдут. Только после этого имеет смысл звать в калькулятор.
 *
 * --- Почему это серверный компонент -------------------------------------
 *
 * Ради поиска. Страница отдаётся готовым HTML со всем текстом и разметкой
 * Schema.org; калькулятор с его `localStorage` живёт отдельным адресом и
 * из выдачи исключён — пустая форма без объяснений там бесполезна.
 *
 * --- Почему нет отзывов, счётчиков и «нам доверяют» ---------------------
 *
 * Инструмент существует, чтобы спорить с работодателем документами.
 * Страница, которая уговаривает вместо того, чтобы приводить нормы, — это
 * ровно та интонация, из-за которой ему и не поверят в кабинете.
 */

const TITLE = "Калькулятор переработки для пожарных";
const DESCRIPTION =
  "Проверьте табель суммированного учёта при графике сутки через трое. " +
  "Считает норму по производственному календарю, исключает отпуска и " +
  "больничные из нормы и показывает расхождения с выданным табелем. " +
  "Данные не покидают браузер.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "калькулятор переработки пожарных",
    "суммированный учёт рабочего времени",
    "сутки через трое норма часов",
    "минус 24 часа за отпуск",
    "табель ФПС ГПС",
    "норма часов при сменном графике",
    "переработка МЧС",
    "приказ 307 приказ 308 МЧС",
  ],
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    locale: "ru_RU",
    siteName: TITLE,
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
      "Законно ли вычитать 24 часа за смену, попавшую в отпуск или больничный?",
    answer:
      "Нет, если речь идёт о расчёте нормы при суммированном учёте. " +
      "Часы, которые по графику пришлись на период отпуска, больничного или " +
      "иного освобождения от работы с сохранением места службы, " +
      "должны уменьшать норму учётного периода, а не фактически отработанное время. " +
      "Иначе получается парадокс: человек был освобождён от службы, но эти часы превращаются в его недоработку. " +
      "Именно такой подход разобран в письме Роструда № 550-6-1 от 01.03.2010.",
  },
  {
    question: "Сколько часов в неделю должен работать пожарный?",
    answer:
      "Базовая норма — 40 часов в неделю. " +
      "Для отдельных категорий устанавливается сокращённая продолжительность: " +
      "36 или 35 часов в неделю. Она зависит от условий труда и других предусмотренных законом оснований. " +
      "Важно: если одновременно есть несколько оснований для сокращения рабочего времени, их продолжительность не складывается автоматически. " +
      "Для сотрудников ФПС ГПС и вольнонаёмных работников применяются разные нормативные основания — поэтому калькулятор сначала определяет ваш статус, а уже затем выбирает соответствующую норму.",
  },
  {
    question: "Какой учётный период применяется при графике «сутки через трое»?",
    answer:
      "Сам график «сутки через трое» не означает, что переработку нужно искать в каждом отдельном месяце. " +
      "Для сотрудников ФПС ГПС учётный период может составлять полугодие или год. " +
      "Для работников по трудовому договору — три месяца, полугодие или год в зависимости от установленных условий. " +
      "Поэтому итоговую переработку нужно определять по окончании всего учётного периода, а не просто сравнивать часы одного месяца с его календарной нормой.",
  },
  {
    question: "Как рассчитывается норма часов за учётный период?",
    answer:
      "За основу берётся производственный календарь. Количество рабочих дней за период сопоставляется с установленной " +
      "недельной нормой, после чего учитываются предпраздничные дни и другие предусмотренные законом сокращения. " +
      "Для сменного работника это означает важную вещь: его норма не определяется количеством смен и не зависит от того, каким по счёту является его караул. " +
      "Она рассчитывается исходя из установленной продолжительности рабочего времени за соответствующий учётный период.",
  },
  {
    question: "Ночные и праздничные часы считаются переработкой?",
    answer:
      "Если ночная, выходная или праздничная смена выполнена в пределах установленной нормы, " +
      "она учитывается как фактически отработанное время, но сама по себе не создаёт сверхурочной работы. " +
      "Поэтому калькулятор не превращает каждый праздничный или ночной час в переработку. " +
      "Он сначала определяет норму, затем факт, и только после этого — есть ли превышение.",
  },
  {
    question: "Куда попадают мои данные?",
    answer:
      "Никуда. Расчёт выполняется в вашем браузере. Сервер не получает данные вашего профиля, сведения о больничных или другие введённые вами параметры. " +
      "Это можно проверить самостоятельно: отключите интернет после загрузки калькулятора и продолжите расчёт.",
  },
];

const STEPS = [
  {
    title: "Укажите условия службы",
    text:
      "Ответьте на семь вопросов: кто вы, какой у вас караул, когда была первая смена в году " +
      "и на каких условиях вы проходите службу. Эти данные нужны, чтобы определить вашу норму рабочего времени.",
  },
  {
    title: "Производственный календарь",
    text:
      "Сверьте корректность производственного календаря. При необходимсоти " +
      "вы можете самостоятельно указать праздничные, предпраздничные и выходные дни за необходимый период",
  },
  {
    title: "Сравнение расчёта с табелем",
    text:
      "Перенесите данные из своего табеля. " +
      "Калькулятор отдельно сопоставит норму, факт и переработку. Если найдётся расхождение, вы увидите его причину и норму, на которой основан расчёт. ",
  },
];

export default function LandingPage() {
  return (
    <>
      <SiteHeader
        tagline="Суммированный учёт служебного времени при графике сутки через трое"
        action={
          <Link
            href="/calculator"
            className="font-semibold inline-flex gap-2 h-9 items-center rounded-xl bg-ink px-4 text-sm text-paper hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace no-underline"
          >
            <div className="hidden xxs:block">
              Калькулятор
            </div>
            <div className="xxs:hidden xs:block">
              <Calculator className="size-5"/>
            </div>
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
              Для аттестованных и вольнонаёмных
            </p>
            <h1 className="max-w-3xl text-2xl md:text-4xl lg:text-6xl leading-[1.15] sm:text-5xl">
              Проверь свой табель
            </h1>
            <p className="max-w-prose text-lg text-ink-muted">
              При графике «сутки через трое» ошибка в табеле может стоить десятков часов переработки.

              Этот калькулятор самостоятельно восстанавливает ваш график караула, определяет норму рабочего времени за учётный период и сравнивает её с данными табеля.
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Link
                href="/calculator"
                className="inline-flex h-11 items-center font-bold rounded-xl bg-ink px-6 text-base text-paper hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace"
              >
                Открыть калькулятор
              </Link>
              <p className="text-sm text-ink-muted">
                Бесплатно · без регистрации
              </p>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- сама проблема */}
        <section aria-labelledby="problem" className="space-y-4 border-b border-rule py-12">
          <h2 id="problem" className="text-2xl md:text-4xl">
            «Отпуск уменьшает норму, а не отработанные часы»
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            <p className="max-w-prose">
              При суммированном учёте время отпуска, больничного или другого освобождения от 
              работы с сохранением места работы <strong> исключается из нормы</strong> рабочего времени.
              При этом норма уменьшается на нормативные часы, приходящиеся на период отсутствия, 
              а фактически отработанные часы остаются без изменений.
            </p>
            <p className="max-w-prose text-ink-muted">
              Это важно для расчёта переработки: отпуск не уменьшает фактически отработанное время. 
              Он уменьшает количество часов, которые сотрудник или работник должен был отработать за учётный период. 
            </p>
            <p className="max-w-prose text-ink-muted">
              
            </p>
          </div>

          <div className="mt-2 grid gap-px overflow-hidden rounded-xl border border-rule bg-rule sm:grid-cols-2">
            <div className="space-y-1 bg-signal-soft p-4">
              <p className="font-display text-xs font-bold uppercase tracking-wide text-signal">
                Как считают неправильно
              </p>
              <p className="font-mono text-sm">норма за отпуск 168 ч</p>
              <p className="font-mono text-sm">факт за отпуск 0 ч − 168 ч = -168 ч</p>
              <p className="text-sm font-semibold">Появилась задолженность</p>
            </div>
            <div className="space-y-1 bg-verify-soft p-4">
              <p className="font-display text-xs font-bold uppercase tracking-wide text-verify">
                Как должно быть
              </p>
              <p className="font-mono text-sm">норма за отпуск 168 ч − 168 ч = 0 ч</p>
              <p className="font-mono text-sm">фактически за отпуск 0 ч</p>
              <p className="text-sm font-semibold">Задолженности нет</p>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- как работает */}
        <section aria-labelledby="how" className="space-y-6 border-b border-rule py-12">
          <h2 id="how" className="text-2xl md:text-4xl">
            Как это работает
          </h2>
          <ol className="grid gap-6 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="space-y-2">
                <p className="font-mono text-3xl leading-none text-ink-faint">
                  {index + 1}
                </p>
                <h3 className="font-display text-base font-bold uppercase tracking-wide">
                  {step.title}
                </h3>
                <p className="text-sm text-ink-muted">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* --------------------------------------------------------------- нормы */}
        <section aria-labelledby="law" className="space-y-4 border-b border-rule py-12">
          <h2 id="law" className="text-2xl md:text-4xl">
            Расчёт, который можно проверить
          </h2>
          <p className="max-w-prose text-ink-muted">
            Калькулятор не берёт цифры «из воздуха».
          </p>
          <p className="max-w-prose text-ink-muted">
            Для каждого этапа расчёта есть правовое основание: от продолжительности службы и 
            учётного периода до расчёта нормы и исключения часов за отпуск или больничный.
          </p>
          <h3 className="text-xl">
            Основные документы:
          </h3>
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {[
              [
                "Федеральный закон № 141-ФЗ от 23.05.2016",
                "Определяет основы службы в федеральной противопожарной службе, включая служебное время и порядок его учёта.",
                "https://base.garant.ru/71403774/",
              ],
              [
                "Трудовой кодекс Российской Федерации",
                "Статьи 91, 92, 95, 99, 104 и 112 — продолжительность рабочего времени, сокращённая рабочая неделя, предпраздничные дни, сверхурочная работа и суммированный учёт.",
                "https://base.garant.ru/12125268/",
              ],
              [
                "Приказ МЧС России № 308 от 24.04.2026",
                "Правила службы сотрудников ФПС ГПС: продолжительность служебного времени, учётный период и особенности сменной службы, включая 24-часовые смены.",
                "https://base.garant.ru/414319430/",
              ],
              [
                "Приказ Минздравсоцразвития РФ от 13.08.2009 № 588н",
                "Определяет порядок исчисления нормы рабочего времени на определенные календарные периоды времени (месяц, квартал, год).",
                "https://normativ.kontur.ru/document?moduleId=1&documentId=143110",
              ],
              [
                "Приказ МЧС России № 307 от 24.04.2026",
                "Правила рабочего времени работников без специальных званий: недельная норма 40, 36 или 35 часов и продолжительность учётного периода.",
                "https://base.garant.ru/414325735/",
              ],
              [
                "Письмо Роструда № 550-6-1 от 01.03.2010",
                "Разъясняет, как уменьшать норму учётного периода на часы, которые сотрудник не должен был отрабатывать по уважительной причине.",
                "https://base.garant.ru/12182312/",
              ],
              [
                "Приказ МЧС России № 410 от 24.09.2018",
                "Правила компенсации за службу в ночное время, выходные и нерабочие праздничные дни. В пределах установленной нормы такие часы не превращаются в дополнительную переработку.",
                "https://base.garant.ru/72115220/",
              ],
              [
                "Письмо Минздравсоцразвития № 22-2/377333-782 от 13.10.2011",
                "О случаях уменьшения нормы рабочего времени работника.",
                "https://base.garant.ru/55172417/",
              ],
              [
                "Приказ МЧС России № 539 от 27.06.2024",
                "Об утверждении Порядка обеспечения денежным довольствием сотрудников федеральной противопожарной службы Государственной противопожарной службы, предоставления им отдельных выплат, а также членам их семей.",
                "https://mchs.gov.ru/dokumenty/bazovye-normativnye-pravovye-akty/normativnye-pravovye-akty-mchs-rossii/8190",
              ],
              [
                "Производственные календари",
                "Информация о количестве рабочих, выходных, праздничных и сокращенных предпраздничных дней, о переносе праздничных дней.",
                "https://www.consultant.ru/law/ref/calendar/",
              ],
              [
                "Приказ МЧС России № 747 от 14.12.2019 г. ",
                "Вопросы оплаты труда работников органов, организаций (учреждений) и подразделений системы МЧС России.",
                "https://mchs.gov.ru/dokumenty/bazovye-normativnye-pravovye-akty/normativnye-pravovye-akty-mchs-rossii/8192",
              ],
            ].map(([source, what, href]) => {
              return (
                <div key={source} className="space-y-0.5 group cursor-pointer">
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
              );
            })}
          </dl>
        </section>

        {/* ------------------------------------------------------------ приватность */}
        <section
          aria-labelledby="privacy"
          className="space-y-3 py-12"
        >
          <h2 id="privacy" className="text-2xl md:text-4xl">
            Ваши данные остаются у вас
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            <p className="max-w-prose">
              Для расчёта могут понадобиться сведения о больничных, а для вольнонаёмных сотрудников — об инвалидности. 
              Это чувствительная информация, и ей не нужно покидать ваше устройство.
            </p>
            <p className="max-w-prose text-ink-muted">
              Поэтому расчёт выполняется не на нашем сервере, а непосредственно в вашем браузере.
              Ваш профиль хранится только на устройстве. 
              При необходимости его можно сохранить в файл и использовать позже.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- вопросы */}
        <section
          aria-labelledby="faq"
          className="space-y-4 border-rule py-12"
        >
          <h2 id="faq" className="text-2xl md:text-4xl">
            Частые вопросы
          </h2>

          <div className="grid gap-2">
            {FAQ.map((item) => (
              <details
                key={item.question}
                className="panel panel-hover group rounded-xl px-4"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-3.5 text-sm md:text-md font-medium marker:hidden">
                  <span>{item.question}</span>

                  <ChevronDown
                    aria-hidden="true"
                    className="size-5 shrink-0 text-ink-muted transition-transform duration-200 group-open:rotate-180"
                  />
                </summary>

                <div className="pb-4 pr-10">
                  <p className="text-sm md:text-md leading-6 text-ink-muted">
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
          <h2 className="text-2xl md:text-4xl">Проверьте свой табель</h2>
          <p className="mx-auto max-w-prose text-ink-muted">
            Это займёт около минуты. Введите свои данные, укажите периоды отсутствия и перенесите часы из табеля.
            Если всё сходится — вы это тоже увидите.
            Если нет — калькулятор покажет разницу в часах и расчёт, из которого она получилась.
          </p>
          <Link
            href="/calculator"
            className="inline-flex h-11 items-center rounded-xl bg-ink px-6 text-base text-paper hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace"
          >
            Открыть калькулятор
          </Link>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="flex flex-col gap-10 md:flex-row items-end px-6 py-8 ">
          <div className="mx-auto w-full max-w-4xl space-y-2 text-xs text-ink-muted xl:max-w-5xl">
            <p className="max-w-prose">
              Калькулятор не является официальным сервисом МЧС России и не заменяет табель или иные документы работодателя.
              Он предназначен для самостоятельной проверки: показывает, как рассчитывается норма рабочего времени и 
              переработка на основании указанных нормативных актов, чтобы вы могли сопоставить результат с выданным вам табелем.
            </p>
            <p className="max-w-prose">
              Точность результата зависит от введённых данных. Перед использованием расчёта убедитесь, 
              что правильно указали статус, караул, дату первой смены и периоды отсутствия.
            </p>
          </div>
          <div className="mx-auto">
            <ThemeToggle/>
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
            "@context": "https://pererabotal.ru",
            "@graph": [
              {
                "@type": "WebApplication",
                name: TITLE,
                description: DESCRIPTION,
                applicationCategory: "BusinessApplication",
                operatingSystem: "Любая, в браузере",
                inLanguage: "ru-RU",
                offers: { "@type": "Offer", price: "0", priceCurrency: "RUB" },
                featureList: [
                  "График караула сутки через трое на год",
                  "Норма учётного периода по производственному календарю",
                  "Исключение отпусков и больничных из нормы",
                  "Сверка с выданным табелем",
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
