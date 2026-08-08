import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/shared/site-header";
import { Logo } from "@/components/ui/logo";

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
      "Законно ли ставить минус 24 часа за смену, попавшую в отпуск или на больничный?",
    answer:
      "Нет. При суммированном учёте часы по графику, пришедшиеся на отпуск, " +
      "больничный и иное освобождение с сохранением места службы, исключаются " +
      "из НОРМЫ учётного периода, а не вычитаются из фактически отработанного " +
      "(письмо Роструда от 01.03.2010 № 550-6-1). Вычитание из факта " +
      "превращает отпуск в долг, которого нет.",
  },
  {
    question: "Какая норма часов в неделю у пожарного?",
    answer:
      "40 часов по общему правилу (Приказ МЧС России от 24.04.2026 № 308 п. 1 " +
      "для сотрудников, № 307 п. 3 для работников). 36 часов — при вредных " +
      "3-4 степени или опасных условиях, а также женщинам в районах Крайнего " +
      "Севера и приравненных к ним местностях. 35 часов — работникам с " +
      "инвалидностью I или II группы (№ 307 п. 5). Сокращения не складываются.",
  },
  {
    question: "Какой учётный период при графике сутки через трое?",
    answer:
      "У сотрудника ФПС ГПС — полугодие или год (Приказ МЧС России № 308 " +
      "п. 2). У работника по трудовому договору — три месяца, полугодие или " +
      "год (№ 307 п. 7). Переработка определяется по итогу учётного периода, " +
      "а не по месяцу.",
  },
  {
    question: "Как считается норма часов за период?",
    answer:
      "Число рабочих дней производственного календаря умножается на недельную " +
      "норму и делится на пять, затем вычитается по часу за каждый " +
      "предпраздничный день (ст. 104 и ст. 95 ТК РФ). Норма сменщика равна " +
      "норме обычной пятидневки за тот же период и от номера караула не " +
      "зависит.",
  },
  {
    question: "Оплачиваются ли ночные и праздничные часы сверху?",
    answer:
      "При суммированном учёте в пределах нормы ночные, выходные и " +
      "праздничные часы дополнительным временем отдыха не компенсируются " +
      "(Приказ МЧС России от 24.09.2018 № 410, п. 14). Калькулятор показывает " +
      "их как факт, но не обещает за них доплату.",
  },
  {
    question: "Куда попадают мои данные?",
    answer:
      "Никуда. Расчёт идёт в вашем браузере, профиль хранится в памяти " +
      "устройства, сервера у приложения нет. Страница работает без " +
      "интернета — это и есть проверка.",
  },
];

const STEPS = [
  {
    title: "Семь ответов о себе",
    text:
      "Кто вы — сотрудник или работник, ваш караул и дата его первой смены в " +
      "году, пол, условия службы. Каждый ответ меняет число в расчёте; " +
      "фамилия, табельный номер и подразделение не спрашиваются.",
  },
  {
    title: "График караула на год",
    text:
      "Из даты первой смены строится весь год: цикл «сутки через трое» " +
      "четырёхдневный, поэтому первая смена приходится на 1, 2, 3 или 4 " +
      "января. Смена на стыке месяцев делится: 16 часов одному, 8 другому.",
  },
  {
    title: "Сверка с выданным табелем",
    text:
      "Впишите числа из своего табеля. Норма, факт и переработка сравниваются " +
      "раздельно — иначе две ошибки скомпенсировали бы друг друга, — и каждое " +
      "расхождение называется вместе с нормой, которой оно опровергается.",
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
            className="inline-flex h-8 items-center rounded-xs bg-ink px-3 text-sm text-paper hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace"
          >
            Открыть калькулятор
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-4xl px-6 pb-16 xl:max-w-5xl">
        {/* ------------------------------------------------------ первый экран */}
        <section className="space-y-6 border-b border-rule py-14">
          <p className="font-mono text-xs uppercase tracking-widest text-ink-faint">
            Для аттестованных и вольнонаёмных · бесплатно · без регистрации
          </p>
          <h1 className="max-w-3xl text-4xl leading-[1.15] sm:text-5xl">
            Проверьте, не отняли ли у вас часы
          </h1>
          <p className="max-w-prose text-lg text-ink-muted">
            Калькулятор переработки для пожарных, дежурящих сутки через трое.
            Строит ваш график караула, считает норму учётного периода по
            производственному календарю и показывает, где выданный табель с ней
            расходится — со ссылкой на норму, которой это опровергается.
          </p>

          <div className="flex flex-wrap items-center gap-4 pt-2">
            <Link
              href="/calculator"
              className="inline-flex h-11 items-center rounded-xs bg-ink px-6 text-base text-paper hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace"
            >
              Открыть калькулятор
            </Link>
            <p className="text-sm text-ink-muted">
              Ничего не устанавливается. Данные остаются в вашем браузере.
            </p>
          </div>
        </section>

        {/* ------------------------------------------------------- сама проблема */}
        <section aria-labelledby="problem" className="space-y-4 border-b border-rule py-12">
          <h2 id="problem" className="text-2xl">
            «Минус 24 часа за смену в отпуске»
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            <p className="max-w-prose">
              Так делают часто, и так делать нельзя. При суммированном учёте
              часы по графику, пришедшиеся на отпуск, больничный или иное
              освобождение с сохранением места службы,{" "}
              <strong>исключаются из нормы</strong>, а не вычитаются из
              фактически отработанного.
            </p>
            <p className="max-w-prose text-ink-muted">
              Разница не в словах. Вычтите смену из факта — и отпуск превратится
              в долг: у человека появится недоработка, которой нет, а
              переработка окажется меньше действительной. Основание —{" "}
              <span className="whitespace-nowrap">
                письмо Роструда от 01.03.2010 № 550-6-1
              </span>{" "}
              и ст. 104 ТК РФ.
            </p>
          </div>

          <div className="mt-2 grid gap-px overflow-hidden rounded-sm border border-rule bg-rule sm:grid-cols-2">
            <div className="space-y-1 bg-signal-soft p-4">
              <p className="font-display text-xs font-bold uppercase tracking-wide text-signal">
                Как считают
              </p>
              <p className="font-mono text-sm">норма 168 ч · факт 192 − 24 = 168 ч</p>
              <p className="text-sm">Переработки нет. Отпуск съел смену.</p>
            </div>
            <div className="space-y-1 bg-verify-soft p-4">
              <p className="font-display text-xs font-bold uppercase tracking-wide text-verify">
                Как должно быть
              </p>
              <p className="font-mono text-sm">норма 168 − 24 = 144 ч · факт 192 ч</p>
              <p className="text-sm">Переработка 48 часов.</p>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- как работает */}
        <section aria-labelledby="how" className="space-y-6 border-b border-rule py-12">
          <h2 id="how" className="text-2xl">
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
          <h2 id="law" className="text-2xl">
            На чём построен расчёт
          </h2>
          <p className="max-w-prose text-ink-muted">
            Каждое число в расчёте сопровождается основанием — не для
            солидности, а потому что нести к начальнику нужно именно его.
          </p>
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {[
              ["Приказ МЧС России № 308 от 24.04.2026", "Сменная служба сотрудников ФПС ГПС: продолжительность службы, учётный период, смена 24 часа."],
              ["Приказ МЧС России № 307 от 24.04.2026", "Сменная работа работников без званий: 40, 36 и 35 часов в неделю, учётный период от трёх месяцев."],
              ["Приказ МЧС России № 410 от 24.09.2018", "Компенсации. П. 14: ночные и праздничные в пределах нормы дополнительно не компенсируются."],
              ["ФЗ-141 от 23.05.2016", "Служба в федеральной противопожарной службе: ст. 54, 55 — служебное время и его учёт."],
              ["Трудовой кодекс РФ", "Ст. 91, 92, 95, 99, 104, 112 — норма, сокращённая неделя, предпраздничные дни, суммированный учёт."],
              ["Письмо Роструда № 550-6-1", "Норма учётного периода уменьшается на часы, пропущенные по уважительной причине."],
            ].map(([source, what]) => (
              <div key={source} className="space-y-0.5">
                <dt className="text-sm font-medium">{source}</dt>
                <dd className="text-sm text-ink-muted">{what}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ------------------------------------------------------------ приватность */}
        <section
          aria-labelledby="privacy"
          className="space-y-3 border-b border-rule py-12"
        >
          <h2 id="privacy" className="text-2xl">
            Мы о вас ничего не узнаём
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            <p className="max-w-prose">
              Калькулятор спрашивает про больничные, а у вольнонаёмных — про
              инвалидность. Это сведения о здоровье, и отправлять их на чужой
              сервер означало бы ровно тот риск, от которого вы сюда и пришли.
            </p>
            <p className="max-w-prose text-ink-muted">
              Поэтому сервера нет вовсе: расчёт идёт в вашем браузере, профиль
              хранится в памяти устройства и выгружается в файл, если нужно
              перенести. Проверить это просто — отключите интернет, страница
              продолжит считать.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- вопросы */}
        <section aria-labelledby="faq" className="space-y-4 border-b border-rule py-12">
          <h2 id="faq" className="text-2xl">
            Частые вопросы
          </h2>
          <dl className="divide-y divide-rule border-y border-rule">
            {FAQ.map((item) => (
              <div key={item.question} className="space-y-1.5 py-4">
                <dt className="font-medium">{item.question}</dt>
                <dd className="max-w-prose text-sm text-ink-muted">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ------------------------------------------------------------- ещё раз CTA */}
        <section className="space-y-4 py-14 text-center">
          <Logo className="mx-auto size-10 text-signal" />
          <h2 className="text-2xl">Посчитайте свой учётный период</h2>
          <p className="mx-auto max-w-prose text-ink-muted">
            Займёт минуту. Если табель сходится — вы это тоже узнаете, и это
            такой же полноценный ответ.
          </p>
          <Link
            href="/calculator"
            className="inline-flex h-11 items-center rounded-xs bg-ink px-6 text-base text-paper hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace"
          >
            Открыть калькулятор
          </Link>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto w-full max-w-4xl space-y-2 px-6 py-8 text-xs text-ink-muted xl:max-w-5xl">
          <p className="max-w-prose">
            Калькулятор не является официальным сервисом МЧС России и не
            заменяет табель работодателя. Он показывает, как норма считается по
            приказам и Трудовому кодексу, чтобы вы могли сверить с ним выданный
            вам документ.
          </p>
          <p>
            Расчёт зависит от того, что вы ввели: проверьте караул, дату первой
            смены и периоды отсутствия, прежде чем на него ссылаться.
          </p>
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
