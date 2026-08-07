import { cn } from "@/lib/utils/cn";

/**
 * FE012 — статус перечисления одним компонентом.
 *
 * DoD: «каждый enum-статус имеет цвет/подпись без дублирования логики».
 *
 * --- Один словарь на все модули ----------------------------------------
 *
 * Статусы приходят из разных модулей (`Timesheet`, `CompensationCase`,
 * `DutySchedule`, `LeaveGrant`, `BalanceMovement`), но означают одно и то
 * же в трёх состояниях: черновик, окончательно, требует внимания. Три
 * словаря по модулям разошлись бы при первом же добавлении статуса, и
 * «утверждён» в одном месте стал бы зелёным, а в другом серым.
 *
 * --- Почему сигнальный цвет так редок ----------------------------------
 *
 * Сигнальный оранжевый означает «требует решения человека», и в этом
 * словаре его получают ровно три статуса: `recalled` (сотрудника отозвали
 * из отпуска — остаток надо предоставить), `reopened` (утверждённый табель
 * переоткрыли — расчёт больше не окончателен) и `cancelled` (приказ
 * отменён). Всё остальное — спокойные состояния, и красить их значило бы
 * обесценить сигнал.
 *
 * --- О доступности ------------------------------------------------------
 *
 * Цвет не единственный носитель различия (WCAG 2.2, 1.4.1 Use of Color):
 * подпись словом стоит в самом бейдже, а форма рамки различает
 * подтверждённое (сплошная) от промежуточного (пунктир).
 */

type Tone = "neutral" | "verify" | "signal" | "draft";

interface StatusMeta {
  label: string;
  tone: Tone;
}

const STATUS: Record<string, StatusMeta> = {
  // Timesheet
  open: { label: "Открыт", tone: "draft" },
  pending_approval: { label: "На утверждении", tone: "neutral" },
  approved: { label: "Утверждён", tone: "verify" },
  reopened: { label: "Переоткрыт", tone: "signal" },

  // DutySchedule
  draft: { label: "Черновик", tone: "draft" },
  archived: { label: "В архиве", tone: "neutral" },

  // CompensationCase
  finalized: { label: "Начислено", tone: "verify" },

  // RuleVersion
  published: { label: "Опубликована", tone: "verify" },
  superseded: { label: "Заменена", tone: "neutral" },

  // LeaveGrant
  active: { label: "Действует", tone: "verify" },
  recalled: { label: "Отозван", tone: "signal" },
  completed: { label: "Завершён", tone: "neutral" },
  cancelled: { label: "Отменён", tone: "signal" },

  // BalanceMovement
  accrual: { label: "Начисление", tone: "verify" },
  consumption: { label: "Списание", tone: "neutral" },

  // CompensationForm
  monetary: { label: "Деньгами", tone: "neutral" },
  additional_rest_time: { label: "Отдыхом", tone: "verify" },

  // Employee
  dismissed: { label: "Уволен", tone: "neutral" },
  on_leave: { label: "В отпуске", tone: "neutral" },
  sick: { label: "На больничном", tone: "neutral" },
};

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "border-rule-strong bg-paper-sunken text-ink-muted",
  verify: "border-verify bg-verify-soft text-verify",
  signal: "border-signal bg-signal-soft text-signal",
  draft: "border-dashed border-rule-strong bg-transparent text-ink-muted",
};

export interface StatusBadgeProps {
  status: string;
  /**
   * Подпись вместо словарной.
   *
   * Нужна там, где одно значение перечисления означает в разных модулях
   * разное. `active` у отпуска — «действует», у СОТРУДНИКА — «на
   * службе»: сказать про человека «действует» нельзя, это слово про
   * документ. Единый словарь такое различие вместить не может — ключ-то
   * один, — а заводить второй словарь значило бы развести и цвета.
   */
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  // Неизвестный статус показывается КАК ЕСТЬ, а не прячется: новое
  // значение перечисления на бэкенде должно быть заметно, а не молча
  // превратиться в пустоту.
  const meta = STATUS[status] ?? { label: status, tone: "neutral" as const };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-xs border px-2 py-0.5",
        "font-display text-xs font-bold uppercase tracking-wide",
        TONE_CLASSES[meta.tone],
        className,
      )}
    >
      {label ?? meta.label}
    </span>
  );
}

/** Подпись статуса без бейджа — для заголовков и таблиц. */
export function statusLabel(status: string): string {
  return STATUS[status]?.label ?? status;
}
