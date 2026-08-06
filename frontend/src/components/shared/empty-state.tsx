import { cn } from "@/lib/utils/cn";

/**
 * FE015 — пустое состояние.
 *
 * Пустой экран — приглашение к действию, а не сообщение о неудаче.
 * Отсюда два обязательных поля: что здесь появится и как это создать.
 * «Нет данных» без второго — тупик.
 *
 * Различие, которое стоит соблюдать: ПУСТО и НЕ НАЙДЕНО — разные ответы.
 * Пусто означает «ещё ничего не заведено», не найдено — «фильтр не дал
 * совпадений», и предлагать в них надо разное: создать против сбросить
 * фильтр.
 */
export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-sm border border-dashed border-rule-strong",
        "px-6 py-12 text-center",
        className,
      )}
    >
      <p className="font-display text-lg font-bold">{title}</p>
      {description ? (
        <p className="max-w-prose text-sm text-ink-muted">{description}</p>
      ) : null}
      {action}
    </div>
  );
}
