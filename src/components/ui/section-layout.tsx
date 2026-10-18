import type { LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export interface LayoutSection<Id extends string> {
  id: Id;
  title: string;
  icon: LucideIcon;
}

/**
 * Страница в две части: слева список разделов со значками, справа открытый
 * раздел. Так устроены учётная запись и настройки.
 *
 * На телефоне список встаёт над содержимым строкой, а `footer` — под ним. Левая
 * колонка закреплена: длинный раздел прокручивается, а список остаётся под рукой.
 */
export function SectionLayout<Id extends string>({
  label,
  sections,
  active,
  onSelect,
  footer,
  children,
}: {
  /** Имя списка для программы чтения. */
  label: string;
  sections: readonly LayoutSection<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
  /** Короткая оговорка под списком. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  const current = sections.find((section) => section.id === active) ?? sections[0]!;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-10">
        <div className="space-y-6 md:sticky md:top-24 md:self-start">
          <nav aria-label={label} className="flex flex-wrap gap-1 md:flex-col">
            {sections.map(({ id, title, icon: Icon }) => {
              const on = id === active;
              return (
                <button
                  key={id}
                  type="button"
                  aria-current={on ? "true" : undefined}
                  onClick={() => onSelect(id)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2",
                    "text-left text-sm whitespace-nowrap transition-colors hover:bg-paper-sunken",
                    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink",
                    on ? "bg-paper-sunken font-medium text-ink" : "text-ink-muted",
                  )}
                >
                  <Icon aria-hidden className="size-4.5 shrink-0" />
                  {title}
                </button>
              );
            })}
          </nav>

          {footer ? (
            <div className="hidden text-xs leading-5 text-ink-faint md:block">{footer}</div>
          ) : null}
        </div>

        <section aria-labelledby={headingId} className="min-w-0 space-y-4">
          <h2 id={headingId} className="flex items-center gap-2 text-md font-medium text-ink">
            <current.icon aria-hidden className="size-5 text-ink-muted" />
            {current.title}
          </h2>
          {children}
        </section>
      </div>

      {footer ? <div className="text-xs leading-5 text-ink-faint md:hidden">{footer}</div> : null}
    </div>
  );
}
