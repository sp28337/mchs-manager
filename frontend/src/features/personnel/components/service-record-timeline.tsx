import { cn } from "@/lib/utils/cn";
import { formatDate, formatMoment } from "@/lib/utils/format";

import {
  LEGAL_BASE_LABELS,
  SERVICE_RECORD_EVENT_LABELS,
  type ServiceRecordEntry,
  type ServiceRecordEventType,
} from "../schemas";

/**
 * FE035 — история прохождения службы.
 *
 * --- Почему это лента, а не таблица -------------------------------------
 *
 * История службы отвечает на вопрос «что и когда изменилось», и порядок
 * здесь — сама суть данных: стаж (ФЗ-141 ст. 38) складывается из
 * периодов, а период определяется соседними записями. Таблица с
 * сортировкой по любому столбцу разрушила бы именно то, ради чего эти
 * записи хранятся.
 *
 * --- Две даты, и они не взаимозаменяемы ---------------------------------
 *
 * `effectiveDate` — когда изменение вступило в силу по приказу;
 * `recordedAt` — когда его внесли в систему. Между ними бывают недели, и
 * проверяющего интересуют обе: первая определяет расчёт, вторая
 * показывает, задним ли числом он внесён. Показывать одну — значит
 * отвечать на половину вопроса.
 *
 * Запись истории службы неизменяема на уровне БД (append-only trigger),
 * поэтому «исправлений» здесь не бывает: ошибка исправляется следующей
 * записью, и обе остаются видны.
 */

export interface ServiceRecordTimelineProps {
  entries: readonly ServiceRecordEntry[];
  /** Пояс подразделения — в нём печатается `recordedAt`. */
  timeZone: string;
  className?: string;
}

/**
 * Приём и увольнение ограничивают службу; перевод и звание меняют её
 * условия. Сигнальным помечено только то, что заканчивает период, —
 * покрасить всё значит не покрасить ничего.
 */
const EVENT_TONE: Record<ServiceRecordEventType, string> = {
  hire: "border-verify bg-verify-soft text-verify",
  assignment: "border-rule-strong bg-paper-sunken text-ink-muted",
  transfer: "border-rule-strong bg-paper-sunken text-ink-muted",
  rank_change: "border-rule-strong bg-paper-sunken text-ink-muted",
  secondment: "border-rule-strong bg-paper-sunken text-ink-muted",
  dismissal: "border-signal bg-signal-soft text-signal",
};

export function ServiceRecordTimeline({
  entries,
  timeZone,
  className,
}: ServiceRecordTimelineProps) {
  if (entries.length === 0) {
    return (
      <p className={cn("text-sm text-ink-muted", className)}>
        Записей истории службы нет. Даже приём на службу здесь не отражён — это
        расхождение, а не пустота: сотрудник без записи о приёме не имеет
        подтверждённой даты начала стажа.
      </p>
    );
  }

  // Свежие сверху: вопрос «что с сотрудником сейчас» задаётся чаще, чем
  // «что было при приёме». Сервер отдаёт записи в хронологическом
  // порядке, и разворот делается здесь — на представлении, а не в
  // запросе, чтобы порядок хранения оставался очевидным.
  const newestFirst = [...entries].reverse();

  return (
    <ol className={cn("space-y-0", className)}>
      {newestFirst.map((entry, index) => {
        const last = index === newestFirst.length - 1;

        return (
          <li key={entry.id} className="flex gap-4">
            {/* Линия времени: вертикаль обрывается на последней записи —
                ниже неё истории нет. */}
            <div className="flex flex-col items-center" aria-hidden>
              <span className="mt-2 size-2 shrink-0 rounded-full bg-rule-strong" />
              {!last ? <span className="w-px flex-1 bg-rule" /> : null}
            </div>

            <div className={cn("min-w-0 flex-1", last ? "pb-1" : "pb-6")}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span
                  className={cn(
                    "inline-flex items-center rounded-xs border px-2 py-0.5",
                    "font-display text-xs font-bold uppercase tracking-wide",
                    EVENT_TONE[entry.eventType],
                  )}
                >
                  {SERVICE_RECORD_EVENT_LABELS[entry.eventType] ?? entry.eventType}
                </span>
                <span className="font-mono text-sm">{formatDate(entry.effectiveDate)}</span>
                <span className="text-xs text-ink-faint">вступило в силу</span>
              </div>

              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                {entry.rank ? (
                  <>
                    <dt className="text-ink-muted">Звание</dt>
                    <dd>{entry.rank}</dd>
                  </>
                ) : null}

                {entry.unitId ? (
                  <>
                    <dt className="text-ink-muted">Подразделение</dt>
                    <dd className="truncate font-mono text-xs">{entry.unitId}</dd>
                  </>
                ) : null}

                {entry.positionId ? (
                  <>
                    <dt className="text-ink-muted">Должность</dt>
                    <dd className="truncate font-mono text-xs">{entry.positionId}</dd>
                  </>
                ) : null}

                {entry.legalBase ? (
                  <>
                    <dt className="text-ink-muted">Основание</dt>
                    <dd>{LEGAL_BASE_LABELS[entry.legalBase] ?? entry.legalBase}</dd>
                  </>
                ) : null}

                <dt className="text-ink-muted">Внесено</dt>
                <dd className="font-mono text-xs text-ink-muted">
                  {formatMoment(entry.recordedAt, timeZone)} ({timeZone})
                </dd>
              </dl>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
