import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarCog,
  CalendarDays,
  ChevronDown,
  Plane,
  Scale,
  ShieldCheck,
  Siren,
  type LucideIcon,
} from "lucide-react";

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
 * --- Как устроен первый экран ---------------------------------------------
 *
 * Слева текст, справа снимок расчёта: не фон под словами, а предмет рядом
 * с ними. Текстовая колонка ограничена половиной ширины именно поэтому —
 * буквам и снимку делить одно место нельзя, иначе снимок приходится
 * гасить до неразличимости, и он перестаёт что-либо показывать.
 *
 * Порядок сверху вниз: чем занята страница (чипы), что она делает
 * (заголовок), одна строка сути, что человек получит (три числа из
 * настоящего расчёта), куда нажать (кнопки).
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

/** Что делает приложение. Шесть карточек, по одному предложению в каждой. */
const FEATURES: [Icon: LucideIcon, title: string, text: string][] = [
  [
    CalendarDays,
    "График караула",
    "Номер караула и одна ваша смена — хоть завтрашняя. Остальной год достроится сам, в обе стороны.",
  ],
  [
    Scale,
    "Норма периода",
    "40, 36 или 35 часов в неделю по производственному календарю. Приложение назовёт пункт приказа при каждой.",
  ],
  [
    Plane,
    "Отпуска и больничные",
    "Уменьшают норму, а не отработанное. Отгул за переработку — не уменьшает: он ею уже погашен.",
  ],
  [
    Siren,
    "Вызовы сверх графика",
    "Соревнования, сборы, резерв, мероприятия и выборы прибавляются к отработанным часам.",
  ],
  [
    CalendarCog,
    "Календарь под правку",
    "Переносы бывают спорными. Праздничный, предпраздничный и выходной день ставятся вручную.",
  ],
  [
    ShieldCheck,
    "Ничего не уходит с устройства",
    "Расчёт идёт в браузере, сервера нет. Профиль хранится на устройстве и выгружается в файл.",
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
            `isolate` держит слои внутри: снимок лежит своим слоем и не
            спорит ни с шапкой, ни со страницей. */}
        <section className="hero-band relative isolate flex min-h-[84lvh] flex-col justify-center border-b border-rule pt-15">
          {/* Сцена задаёт перспективу, плита — наклон: точка схода тогда
              одна на весь экран и стоит там, где стоит читатель, у левого
              края. Плита уходит от него вправо и вглубь.

              Снимок расчёта, а не рисунок: человек видит то, что получит.
              Две темы — два файла: перекрасить снимок фильтрами дороже и
              грязнее, чем снять его дважды. */}
          <div aria-hidden className="hero-stage -z-10">
            <div className="hero-shot">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/hero-grid-dark.webp"
                alt=""
                width={1600}
                height={977}
                className="hero-shot__plate hidden dark:block"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/hero-grid-light.webp"
                alt=""
                width={1600}
                height={977}
                className="hero-shot__plate dark:hidden"
              />
            </div>
          </div>

          {/* Половина ширины на широком экране: вторая половина занята
              снимком, и заезжать на него текстом нельзя. */}
          {/* Ширина колонки идёт двумя ступенями: на 1024 три кнопки в
              48% не помещаются и ломаются на две строки, а на 1280 и
              шире их ряд свободно встаёт в одну. */}
          <div className="space-y-6 lg:max-w-[62%] xl:max-w-[48%]">
            <div className="rise flex flex-wrap items-center gap-2">
              <span className="rounded-xl bg-paper-raised px-3 py-1.5 font-mono text-xs text-ink-muted">
                Сутки через трое
              </span>
              <a
                href="#minus"
                className="inline-flex items-center gap-1.5 rounded-xl bg-signal-soft px-3 py-1.5 text-xs font-medium text-signal no-underline hover:opacity-90"
              >
                Минус 24 часа за отпуск
                <ArrowRight aria-hidden className="size-3.5" />
              </a>
            </div>

            {/* Переносы расставлены руками, а не отданы автоматике: при
                свободном переносе на широком экране последней строкой
                остаётся одно слово «трое», и заголовок разваливается.
                Неразрывные пробелы держат предлог при своём слове, а
                «через трое» — вместе на узком экране.

                Чем крупнее кегль, тем плотнее строки: интерлиньяж 0,92 и
                чуть отрицательный трекинг. Отрицательный «чуть» — PT Sans
                Narrow и без того узкий, сильное сжатие слепит буквы. */}
            <h1 className="rise rise-2 text-4xl leading-[0.92] tracking-[-0.01em] text-balance sm:text-5xl lg:text-6xl">
              <span className="block text-signal">Переработка</span>
              при&nbsp;графике
              <br className="hidden lg:inline" /> сутки через&nbsp;трое
            </h1>

            <p className="rise rise-3 max-w-prose text-lg leading-snug text-ink-muted text-pretty">
              Норма по&nbsp;производственному календарю. Отпуск уменьшает норму,
              а&nbsp;не&nbsp;отработанные часы.
            </p>

            <div className="rise rise-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <ToCalculator>Открыть калькулятор</ToCalculator>
                <SecondaryLink href="#what">Что считает</SecondaryLink>
                <SecondaryLink href="#law">На чём основано</SecondaryLink>
              </div>
              {/* Строка снятия возражения у самой кнопки: до неё доходят
                  те, кто уже готов нажать, и именно там появляется
                  вопрос «а что попросят взамен». */}
              <p className="text-xs text-ink-faint">
                Без регистрации. Данные остаются на устройстве.
              </p>
            </div>

            {/* Три числа в том же виде, что и в расчёте: первый экран
                показывает результат, а не обещает его. */}
            <div className="rise rise-5 space-y-2 pt-2">
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
          </div>
        </section>

        {/* --------------------------------------------------------- что делает */}
        <section aria-labelledby="what" className="space-y-5 border-b border-rule py-14">
          <h2 id="what" className="text-2xl md:text-4xl">
            Что делает приложение
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
          <p className="max-w-prose text-sm text-ink-muted">
            Сверяете с табелем вы сами: приложение даёт число и норму, по которой
            оно получено.
          </p>
        </section>

        {/* ---------------------------------------------------------- минус 24 */}
        <section aria-labelledby="minus" className="space-y-5 border-b border-rule py-14">
          <h2 id="minus" className="text-2xl md:text-4xl">
            Откуда берётся недоработка, которой нет
          </h2>
          <p className="max-w-prose text-ink-muted">
            Смена, попавшая в отпуск, вычитается из нормы периода. Вычтут из
            отработанного — число то же, итог противоположный.
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
            Письмо Роструда № 550-6-1 от 01.03.2010: часы, которые не нужно было
            отрабатывать по уважительной причине, исключаются из нормы периода.
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
              Три ответа: караул, ваша смена, недельная норма.
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

/** Второстепенная кнопка первого экрана: переход к разделу этой же страницы. */
function SecondaryLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={cn(
        // Высота как у главной кнопки — 44 точки, меньше нельзя пальцем.
        // Мельче только подпись и поля: рядом с «Открыть калькулятор» это
        // второй голос, а не второй такой же.
        "inline-flex h-11 shrink-0 items-center rounded-xl bg-paper-raised px-4 text-sm",
        "font-medium text-ink no-underline hover:bg-paper-sunken",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace",
      )}
    >
      {children}
    </a>
  );
}
