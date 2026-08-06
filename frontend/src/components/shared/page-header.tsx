import { cn } from "@/lib/utils/cn";

/**
 * FE015 — заголовок страницы.
 *
 * Устройство подчинено одному наблюдению: КАЖДЫЙ экран этой системы
 * отвечает на вопрос «чьё время, за какой период, в каком состоянии».
 * Табель, дело о компенсации, отпуск, баланс — всюду тот же триптих.
 *
 * Поэтому у заголовка постоянные слоты: надзаголовок (чьё), заголовок
 * (что), период и состояние справа. Человек, переходящий между модулями,
 * находит их на одном месте, а не перечитывает страницу заново.
 *
 * Надзаголовок здесь не декоративный «eyebrow»: он несёт субъект —
 * фамилию сотрудника или название подразделения, — и без него заголовок
 * «Табель за март» не отвечает на первый же вопрос проверяющего.
 */
export interface PageHeaderProps {
  /** Субъект: сотрудник, подразделение, документ. */
  eyebrow?: string;
  title: string;
  /** Период в человеческом виде: «март 2026». */
  period?: string;
  description?: string;
  /** Статус и действия. */
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  period,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-start justify-between gap-4 border-b border-rule pb-4",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        {eyebrow ? (
          <p className="truncate font-mono text-xs uppercase tracking-widest text-ink-faint">
            {eyebrow}
          </p>
        ) : null}

        <h1 className="text-2xl leading-tight">
          {title}
          {period ? (
            <span className="ml-2 font-sans text-base font-normal text-ink-muted">
              {period}
            </span>
          ) : null}
        </h1>

        {description ? (
          <p className="max-w-prose text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>

      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
