"use client";

import { useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils/cn";

import type { PeriodCalculation } from "../domain/calculation";
import { Dec, parseHours } from "../domain/decimal";
import type { OvertimePayEstimate } from "../domain/overtime-pay";
import { CALLOUT_LABELS } from "../schemas";
import {
  REPORT_REQUEST_LABELS,
  buildReport,
  renderPlainText,
  renderRtf,
  reportFileName,
  type ReportDocument,
  type ReportRequest,
} from "../domain/report-documents";
import type { StoredProfile } from "../storage/profile";

/**
 * Рапорт, заявление и справка о том, как их подавать.
 *
 * --- Почему это часть калькулятора, а не отдельная страница -------------
 *
 * Документ должен быть собран из ТЕХ ЖЕ чисел, что стоят в расчёте. Отдельная
 * страница с пустым шаблоном заставила бы человека переписывать часы и сумму
 * руками — то есть ровно там, где цифра и меняется. Здесь она подставляется
 * сама, и если расчёт изменится, изменится и бумага.
 *
 * --- Почему рядом справка, а не только образец --------------------------
 *
 * Образец без порядка подачи бесполезен: рапорт, отданный в руки без
 * отметки о принятии, юридически не существует. Всё, что человек сможет
 * потом предъявить, — это его второй экземпляр со входящим номером, и
 * сказать об этом важнее, чем красиво сверстать текст.
 */
export function ReportDocumentsCard({
  profile,
  calculation,
  pay,
  reported,
  onChange,
}: {
  profile: StoredProfile;
  calculation: PeriodCalculation;
  pay: OvertimePayEstimate | null;
  /** Числа, которые человек прочитал в выданном табеле. */
  reported: { norm: string; actual: string; overtime: string } | null;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
}) {
  const [request, setRequest] = useState<ReportRequest>("payment");
  const [copied, setCopied] = useState(false);
  const attested = profile.employmentKind === "attested";

  const doc = useMemo(
    () =>
      buildReport({
        employment: profile.employmentKind,
        request,
        identity: {
          addressee: profile.documentAddressee,
          fullName: profile.documentFullName,
          rank: profile.documentRank,
          position: profile.documentPosition,
        },
        periodStart: calculation.periodStart,
        periodEnd: calculation.periodEnd,
        overtimeHours: calculation.overtimeHours,
        money:
          request === "payment" && pay
            ? {
                monthlyBase: pay.primary.monthlyBase,
                hourlyRate: pay.primary.hourlyRate,
                total: pay.primary.total,
                atOneAndHalfHours: pay.primary.atOneAndHalf.hours,
                atDoubleHours: pay.primary.atDouble.hours,
              }
            : null,
        correction: reported
          ? {
              reportedNormHours: parseHours(reported.norm),
              reportedActualHours: parseHours(reported.actual),
              reportedOvertimeHours: parseHours(reported.overtime),
              normHours: calculation.normHours,
              actualHours: calculation.actualHours,
              excludedHours: calculation.excludedHours,
              absentShifts: calculation.absentShifts,
            }
          : null,
        callouts: calloutsInPeriod(profile, calculation),
      }),
    [profile, request, calculation, pay, reported],
  );

  function download() {
    const blob = new Blob([renderRtf(doc)], { type: "application/rtf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = reportFileName(profile.employmentKind, request, calculation.periodStart);
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(renderPlainText(doc));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="max-w-prose text-sm text-ink-muted">
        Расчёт сам ничего не меняет. Часы возвращают по{" "}
        {attested ? "рапорту" : "заявлению"}, на вашем экземпляре которого стоит
        отметка о принятии. Ниже — образец, собранный из чисел этого расчёта, и
        порядок подачи.
      </p>

      {calculation.overtimeHours.isZero() && (request === "rest" || request === "payment") ? (
        <p className="max-w-prose rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm">
          Переработки за выбранный период расчёт не показывает, и требовать за
          неё нечего. Образец ниже всё равно собран — посмотреть его можно, но
          прежде проверьте период и внесённые отсутствия.
        </p>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
          О чём бумага
        </legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(REPORT_REQUEST_LABELS) as ReportRequest[]).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={request === option ? "default" : "outline"}
              aria-pressed={request === option}
              onClick={() => setRequest(option)}
            >
              {REPORT_REQUEST_LABELS[option]}
            </Button>
          ))}
        </div>
        {/* Развилка не оформительская: часы, за которые дали отдых, в оплату
            не включаются. Просить одновременно и то и другое за одни часы
            нельзя, и человек должен узнать об этом до того, как подаст
            бумагу, а не из отказа. */}
        <p className="max-w-prose text-xs text-ink-muted">
          {request === "correction"
            ? "Пока в табеле стоят неверные числа, требовать по ним компенсацию бессмысленно: считать будут от того, что в табеле. Сначала числа, потом деньги."
            : request === "callout_record"
              ? "Часов, которых нет в табеле, для расчёта не существует. Этот рапорт заводит бумагу там, где её не завели."
              : attested
                ? "Одно или другое, но не оба за одни часы: время, за которое предоставлен отдых, в оплату не включается (п. 109 приказа № 539)."
                : "Одно или другое, но не оба за одни часы: часть 1 статьи 152 ТК РФ даёт отдых ВМЕСТО повышенной оплаты."}
        </p>
      </fieldset>

      {/* Оба новых документа опираются на данные из ДРУГИХ разделов, и без
          них выходят с прочерками. Сказать об этом надо здесь: иначе
          человек скачает пустой бланк и решит, что так и задумано. */}
      {request === "correction" && reported === null ? (
        <p className="max-w-prose rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm">
          Внесите числа из выданного табеля в разделе «Что написано в вашем
          табеле» — тогда в рапорте встанут две колонки: что указано у них и
          что должно быть. Без них требование нечем проверить.
        </p>
      ) : null}
      {request === "callout_record" && calloutsInPeriod(profile, calculation).length === 0 ? (
        <p className="max-w-prose rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm">
          Вызовов за выбранный период не внесено. Добавьте их в разделе «Вызовы
          помимо графика» — даты, куда вызывали и сколько часов, — и они встанут
          в рапорт перечнем.
        </p>
      ) : null}

      <IdentityFields profile={profile} onChange={onChange} attested={attested} />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={download}>
            Скачать .rtf
          </Button>
          <Button type="button" variant="outline" onClick={copy}>
            {copied ? "Скопировано" : "Скопировать текст"}
          </Button>
          <p className="text-xs text-ink-muted">
            Файл открывается Word, LibreOffice и «Google Документами» —
            дописать и распечатать можно там же.
          </p>
        </div>

        {doc.blanks.length > 0 ? (
          <p className="max-w-prose rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm">
            В образце остались прочерки: не указано{" "}
            {doc.blanks.join(", ")}. Заполните поля выше — или впишите от руки в
            распечатанном.
          </p>
        ) : null}
      </div>

      <Preview doc={doc} />

      <Guidance attested={attested} request={request} />
    </div>
  );
}

/**
 * Вызовы, попавшие в выбранный период.
 *
 * Часы считаются по СУТКАМ внутри периода, а не по всей длине вызова:
 * трёхдневный сбор на стыке полугодий принадлежит обоим периодам частями,
 * и записать его целиком в один значило бы потребовать чужие часы.
 */
function calloutsInPeriod(profile: StoredProfile, calculation: PeriodCalculation) {
  const out = [];
  for (const callout of profile.callouts) {
    const start =
      callout.startsOn > calculation.periodStart ? callout.startsOn : calculation.periodStart;
    const lastDay = lastIncludedDay(calculation.periodEnd);
    const end = callout.endsOn < lastDay ? callout.endsOn : lastDay;
    if (end < start) continue;
    const days = dayCount(start, end);
    const hoursPerDay = new Dec(callout.hoursPerDay);
    out.push({
      start,
      endInclusive: end,
      kindLabel: CALLOUT_LABELS[callout.kind],
      hoursPerDay,
      totalHours: hoursPerDay.times(days),
    });
  }
  return out.sort((left, right) => left.start.localeCompare(right.start));
}

function lastIncludedDay(periodEnd: string) {
  const time = Date.UTC(
    Number(periodEnd.slice(0, 4)),
    Number(periodEnd.slice(5, 7)) - 1,
    Number(periodEnd.slice(8, 10)) - 1,
  );
  return new Date(time).toISOString().slice(0, 10) as typeof periodEnd;
}

function dayCount(from: string, to: string) {
  const day = 86_400_000;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / day) + 1;
}

/**
 * Реквизиты шапки и подписи.
 *
 * Подсказки показывают не «Иванов И. И.», а полную форму со званием и
 * частью: человек, впервые пишущий рапорт, ошибается именно в шапке, и
 * образец в подсказке экономит ему возврат бумаги.
 */
function IdentityFields({
  profile,
  onChange,
  attested,
}: {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  attested: boolean;
}) {
  const addresseeId = useId();
  const nameId = useId();
  const rankId = useId();
  const positionId = useId();

  const set = (key: keyof StoredProfile) => (value: string) =>
    onChange((previous) => ({ ...previous, [key]: value }));

  return (
    <div className="space-y-4 rounded-sm border border-rule bg-paper-raised p-4">
      <p className="max-w-prose text-xs text-ink-muted">
        Эти поля нужны только для бумаги — на расчёт они не влияют. Как и всё
        остальное, они остаются в этом браузере и никуда не отправляются.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Шапка многострочная: в служебной переписке её разбивают на
            три-четыре строки, и одна строка в поле означала бы, что
            переносы негде поставить. */}
        <Field
          id={addresseeId}
          label="Кому (в дательном падеже)"
          hint="Каждая строка шапки — с новой строки. Например: «Начальнику ПСЧ-5 1 ПСО ФПС ГПС / ГУ МЧС России по Тверской области / подполковнику внутренней службы / А. А. Петрову»."
          value={profile.documentAddressee}
          onChange={set("documentAddressee")}
          multiline
        />
        <Field
          id={nameId}
          label="Фамилия, имя, отчество"
          hint="Как в служебных документах: Иванов Иван Иванович."
          value={profile.documentFullName}
          onChange={set("documentFullName")}
        />
        {attested ? (
          <Field
            id={rankId}
            label="Звание"
            hint="Например: старший сержант внутренней службы."
            value={profile.documentRank}
            onChange={set("documentRank")}
          />
        ) : null}
        <Field
          id={positionId}
          label="Должность"
          hint={
            attested
              ? "Например: пожарный 3 караула ПСЧ-5."
              : "Например: водитель 3 караула ПСЧ-5."
          }
          value={profile.documentPosition}
          onChange={set("documentPosition")}
        />
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  value,
  onChange,
  multiline = false,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  const Control = multiline ? Textarea : Input;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Control
        id={id}
        rows={multiline ? 4 : undefined}
        value={value}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={`${id}-hint`} className="text-xs text-ink-muted">
        {hint}
      </p>
    </div>
  );
}

/**
 * Образец так, как он выйдет на лист.
 *
 * Шапка справа, тело по ширине с отступом первой строки, подпись слева —
 * то же, что задаёт RTF. Человек должен узнать в этом бумагу, а не
 * увидеть текст в рамке: узнавание и есть половина ответа на вопрос
 * «правильно ли я пишу».
 */
function Preview({ doc }: { doc: ReportDocument }) {
  return (
    <figure className="space-y-2">
      <figcaption className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
        {doc.title}
      </figcaption>
      <div
        className={cn(
          "overflow-x-auto rounded-sm border border-rule bg-paper px-6 py-8",
          "text-[13px] leading-relaxed sm:px-10 sm:text-sm",
        )}
      >
        <div className="mx-auto max-w-[46rem] space-y-4">
          {doc.addressLines.length > 0 ? (
            <div className="ml-auto w-full max-w-sm text-right">
              {doc.addressLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : null}

          <p className="pt-2 text-center font-bold uppercase tracking-wide">
            {doc.heading}
          </p>

          {/* По ширине — только там, где строка достаточно длинная. На
              узком экране выключка по формату рвёт строку из пяти слов
              на разряженные куски. */}
          <div className="space-y-3 sm:text-justify">
            {doc.bodyParagraphs.map((paragraph) => (
              <p key={paragraph} className="indent-8">
                {paragraph}
              </p>
            ))}
          </div>

          <div className="space-y-1 pt-6">
            {doc.signatureLines.map((line) => (
              <p key={line} className="whitespace-pre-wrap">
                {line}
              </p>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

/**
 * Как и когда подавать.
 *
 * --- Почему сроки названы первыми --------------------------------------
 *
 * Переработка существует только по итогу учётного периода: до его конца
 * требовать нечего, а после — время идёт. Человек, узнавший о своём праве
 * через два года, обнаруживает, что срок обращения истёк, и это худший
 * способ узнать про сроки.
 */
function Guidance({
  attested,
  request,
}: {
  attested: boolean;
  request: ReportRequest;
}) {
  const noun = attested ? "рапорт" : "заявление";

  return (
    <div className="space-y-5 border-t border-rule pt-5">
      <h4 className="font-display text-sm font-bold uppercase tracking-wide">
        Как и когда подавать
      </h4>

      {request === "correction" ? (
        <Step title="Почему это подают первым">
          <p>
            Норму учётного периода уменьшают на часы, приходящиеся на время,
            когда вас освободили от обязанностей с сохранением места{" "}
            {attested ? "службы" : "работы"} (письмо Роструда от 01.03.2010
            № 550-6-1). Если вместо этого их вычитают из{" "}
            <strong>фактически отработанного</strong>, ошибка бьёт дважды: норма
            осталась полной, а факт ещё и уменьшили. Потерянные часы — двойная
            величина исключаемых.
          </p>
          <p>
            Отработанным считается время, когда вы исполняли обязанности. Часы
            отпуска и больничного в него не входят изначально — вычитать их
            оттуда нечего. Требовать компенсацию, не исправив этого, смысла нет:
            считать будут от чисел табеля.
          </p>
          <p>
            Просите не только исправить, но и{" "}
            <strong>ознакомить вас с исправленным табелем</strong>. Иначе
            «исправили» останется словами.
          </p>
        </Step>
      ) : null}

      {request === "callout_record" ? (
        <Step title="Вызвали, но ничего не оформили">
          <p>
            {attested ? (
              <>
                Устно вызвать могут — Порядок, утверждённый приказом МЧС России
                от 24.09.2018 № 410, это допускает. Но тогда{" "}
                <strong>прямой руководитель обязан в течение двух рабочих
                дней</strong> доложить о привлечении рапортом, указав основания
                и продолжительность. Не сделали — нарушение на их стороне, не на
                вашей.
              </>
            ) : (
              <>
                Привлечение к работе помимо графика оформляется приказом
                (распоряжением), а отработанное время работодатель обязан
                учитывать (ст. 91 ТК РФ). Не оформили — нарушение на их стороне,
                не на вашей.
              </>
            )}
          </p>
          <p>
            Но доказывать часы придётся вам, поэтому <strong>ведите свою
            запись сразу</strong>: дата, время начала и окончания, кто вызвал,
            куда и что делали. Годятся и косвенные следы — путевые листы,
            журнал выездов, приказ о соревнованиях, переписка, скриншоты
            вызова.
          </p>
          <p>
            Этот {noun} и есть способ завести бумагу там, где её не завели: с
            отметкой о принятии у вас появляется документ, в котором часы
            названы и который подразделение получило.
          </p>
        </Step>
      ) : null}

      <Step title="Когда">
        {request === "callout_record" ? (
          <p>
            Как можно скорее после вызова, а не по итогу года: чем свежее
            бумага, тем труднее сказать, что вызова не было. Ждать закрытия
            учётного периода здесь не нужно — речь не о переработке, а о том,
            чтобы часы вообще попали в табель.
          </p>
        ) : null}
        <p>
          Переработка определяется по ИТОГУ учётного периода (ст. 104 ТК РФ;{" "}
          {attested
            ? "Приказ МЧС России от 24.04.2026 № 308 п. 2"
            : "Приказ МЧС России от 24.04.2026 № 307 п. 7"}
          ). До конца периода её ещё нет — график может измениться, — поэтому{" "}
          {noun} подают после его закрытия.
        </p>
        <p>
          Но не откладывайте.{" "}
          {attested ? (
            <>
              Служебный спор рассматривается по обращению, поданному{" "}
              <strong>в течение трёх месяцев</strong> со дня, когда вы узнали о
              нарушении своего права (ст. 73 Федерального закона от 23.05.2016
              № 141-ФЗ).
            </>
          ) : (
            <>
              По спору о невыплате в суд обращаются{" "}
              <strong>в течение одного года</strong> со дня установленного срока
              выплаты (ч. 2 ст. 392 ТК РФ).
            </>
          )}
        </p>
        {request === "rest" ? (
          <p>
            Если вам нужен ОТДЫХ, а не деньги, заявите об этом сразу по итогу
            периода или заранее:{" "}
            {attested
              ? "п. 103 приказа № 539 связывает денежную выплату именно с тем, что отдых не предоставлен, — то есть по умолчанию дело идёт к деньгам."
              : "по ч. 1 ст. 152 ТК РФ отдых даётся по желанию работника, а по умолчанию сверхурочная работа оплачивается."}
          </p>
        ) : null}
      </Step>

      <Step title="Кому и через кого">
        {attested ? (
          <p>
            {attested ? "Рапорт" : "Заявление"} — на имя начальника
            подразделения, согласованный с непосредственным руководителем: такой порядок задаёт Порядок,
            утверждённый приказом МЧС России от 24.09.2018 № 410. Подпись
            непосредственного руководителя о согласовании ставится на самом{" "}
            {noun}е.
          </p>
        ) : (
          <p>
            Заявление — работодателю: руководителю подразделения. Передавать
            удобнее через кадры или делопроизводство — там его зарегистрируют.
          </p>
        )}
      </Step>

      <Step title="Как подать, чтобы это нельзя было не заметить">
        <ul className="ml-4 list-disc space-y-1.5">
          <li>
            Два экземпляра. На вашем — <strong>отметка о принятии</strong>: дата,
            входящий номер, должность, подпись и фамилия принявшего.
          </li>
          <li>
            Отметку не ставят — отправьте почтой заказным письмом с описью
            вложения и уведомлением о вручении. Квитанция, опись и уведомление
            заменяют отметку.
          </li>
          <li>Сфотографируйте свой экземпляр сразу, до того как уйдёте.</li>
        </ul>
      </Step>

      <Step title="Что приложить">
        <ul className="ml-4 list-disc space-y-1.5">
          <li>
            Свой расчёт за период — распечатайте эту страницу или сохраните
            профиль кнопкой «Сохранить в файл».
          </li>
          <li>
            Выписку из табеля учёта {attested ? "служебного" : "рабочего"}{" "}
            времени за период. Её можно запросить письменно — и отказ в выдаче
            сам по себе о многом скажет.
          </li>
          <li>Копию графика смен, если он у вас на руках.</li>
        </ul>
      </Step>

      <Step title="Чего ждать">
        {request === "correction" ? (
          <ul className="ml-4 list-disc space-y-1.5">
            <li>
              Исправленный табель и ознакомление с ним. Сверьте числа заново —
              «исправили» без вашей подписи об ознакомлении ничего не значит.
            </li>
            <li>
              Отказ, скорее всего, будет со ссылкой на «так считает программа»
              или «так велели». Ни то, ни другое нормой не является: попросите
              назвать акт, который позволяет вычитать часы отсутствия из
              отработанного. Такого акта нет.
            </li>
            <li>
              Исправленный учёт — основание требовать компенсацию. Подавайте
              следующую бумагу только после того, как числа сойдутся.
            </li>
          </ul>
        ) : request === "callout_record" ? (
          <ul className="ml-4 list-disc space-y-1.5">
            <li>
              Внесение часов в табель и{" "}
              {attested
                ? "оформление привлечения приказом (Порядок № 410)"
                : "приказ (распоряжение) о привлечении"}
              . Просите копию или ознакомление под подпись.
            </li>
            <li>
              Ответ «вызовов не было» — повод показать свою запись и косвенные
              следы. Именно поэтому её и ведут сразу, а не по итогу года.
            </li>
            <li>
              Часы попали в табель — дальше они считаются как обычная
              переработка, и за них полагается отдых или деньги.
            </li>
          </ul>
        ) : request === "payment" ? (
          <ul className="ml-4 list-disc space-y-1.5">
            {attested ? (
              <>
                <li>
                  Приказ, в котором указано количество часов на каждого
                  сотрудника (п. 108 приказа № 539). Просите копию или выписку —
                  это и есть документ, подтверждающий, сколько часов вам
                  признали.
                </li>
                <li>
                  Смены, попавшие на субботу и воскресенье{" "}
                  <strong>по графику сменности</strong>, отдельной компенсации
                  не дают (п. 104 приказа № 539).
                </li>
                <li>
                  Компенсация не выплачивается за службу в особых условиях —
                  при ликвидации ЧС, в зоне контртеррористической операции, при
                  военном или чрезвычайном положении (п. 111 приказа № 539).
                </li>
              </>
            ) : (
              <li>
                Оплату в повышенном размере по ч. 1 ст. 152 ТК РФ. Коллективный
                договор или локальный акт могут установить размеры выше — тогда
                применяются они.
              </li>
            )}
            <li>Сумма начисляется до НДФЛ: на руки придёт меньше.</li>
          </ul>
        ) : (
          <ul className="ml-4 list-disc space-y-1.5">
            {attested ? (
              <>
                <li>
                  Решение начальника о предоставлении дополнительного времени
                  отдыха (приказ № 410).
                </li>
                <li>
                  Часы, за которые отдых предоставлен, в оплату уже не войдут
                  (п. 109 приказа № 539), а день отдыха за выходной или
                  праздник оплате не подлежит (п. 110).
                </li>
              </>
            ) : (
              <li>
                Дополнительное время отдыха{" "}
                <strong>не менее отработанного сверхурочно</strong> (ч. 1
                ст. 152 ТК РФ). Меньше — незаконно.
              </li>
            )}
          </ul>
        )}
      </Step>

      <Step title="Если отказали или молчат">
        {attested ? (
          <p>
            Служебный спор: обращение к руководителю федерального органа
            исполнительной власти в области пожарной безопасности либо в суд —
            в течение трёх месяцев со дня, когда вы узнали о нарушении права
            (ст. 73 ФЗ-141). Ваш экземпляр {noun}а с отметкой о принятии — то,
            с чем идут дальше.
          </p>
        ) : (
          <p>
            Государственная инспекция труда, прокуратура, суд. По спору о
            невыплате — один год со дня установленного срока выплаты (ч. 2
            ст. 392 ТК РФ). Ваш экземпляр {noun}я с отметкой о принятии — то, с
            чем идут дальше.
          </p>
        )}
      </Step>

      <p className="max-w-prose text-xs text-ink-muted">
        Образец — не единственно возможная форма. В части может быть свой
        бланк или заведённый порядок; текст выше составлен по нормам, но
        сверьтесь с тем, как {noun} принимают у вас. Приложение считает часы, а
        не даёт юридическую консультацию.
      </p>
    </div>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h5 className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
        {title}
      </h5>
      <div className="max-w-prose space-y-2 text-sm">{children}</div>
    </section>
  );
}
