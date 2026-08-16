"use client";

import { Banknote, Settings2, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils/cn";

import type { PeriodCalculation } from "../domain/calculation";
import type { OvertimePayEstimate } from "../domain/overtime-pay";
import type { StoredProfile } from "../storage/profile";
import { OvertimePayCard } from "./overtime-pay-card";
import { SettingsPanel } from "./settings-panel";

/**
 * Настройки и деньги — из шапки.
 *
 * --- Почему не колонкой сбоку --------------------------------------------
 *
 * Колонка была: слева ввод, справа вывод. Она честно работала, но платила
 * за это девятнадцатью ремами ширины — у графика на год и двенадцати
 * календарных сеток это самое дорогое, что можно отнять.
 *
 * Из того, что в ней стояло, почти всё нашло себе место ближе к делу:
 * период переехал в панель над сеткой, которой он и управляет, а отпуска и
 * вызовы вносятся нажатием по самому дню. Осталось два блока, которые ни к
 * какому месту на странице не привязаны, — ответы анкеты и оклад. Их место
 * в шапке, там же, где «Сохранить в файл»: видно всегда, не занимает
 * ничего.
 *
 * --- Почему в окне, а не выпадающим списком ------------------------------
 *
 * В обоих блоках форма: восемь полей в одном, поле и разбор суммы в
 * другом. Выпадающая панель такого размера — то же модальное окно, только
 * без перехвата фокуса и без Esc. Родной `dialog` даёт и то и другое.
 */

type ToolId = "settings" | "pay";

const TOOL_META: Record<ToolId, { title: string; Icon: LucideIcon }> = {
  settings: { title: "Настройки", Icon: Settings2 },
  pay: { title: "Сколько это в деньгах", Icon: Banknote },
};

const TOOL_ORDER: readonly ToolId[] = ["pay", "settings"];

export function HeaderTools({
  profile,
  calculation,
  pay,
  onChange,
  className,
}: {
  profile: StoredProfile;
  calculation: PeriodCalculation;
  pay: OvertimePayEstimate | null;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  className?: string;
}) {
  const [open, setOpen] = useState<ToolId | null>(null);

  const bodies: Record<ToolId, ReactNode> = {
    settings: <SettingsPanel profile={profile} onChange={onChange} />,
    pay: (
      <OvertimePayCard
        profile={profile}
        calculation={calculation}
        pay={pay}
        onChange={onChange}
      />
    ),
  };

  return (
    <>
      {/* Одна обведённая группа, а не отдельные кнопки: рядом стоит
          «Сохранить в файл» такой же высоты и с такой же рамкой, и голые
          значки возле неё выглядели бы обрывками. Высота считается до
          пикселя — два по краю, восемь на кнопку, два. */}
      <div
        role="group"
        aria-label="Настройки и расчёт"
        className={cn(
          "inline-flex h-9 items-center rounded-xl border border-rule-strong bg-paper-raised p-0.5",
          className,
        )}
      >
        {TOOL_ORDER.map((id) => {
          const { title, Icon } = TOOL_META[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => setOpen(id)}
              aria-label={title}
              title={title}
              className={cn(
                "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg",
                "text-ink-muted transition-colors hover:bg-paper-sunken hover:text-ink",
                "focus-visible:outline-2 focus-visible:-outline-offset-2",
                "focus-visible:outline-trace",
              )}
            >
              <Icon aria-hidden className="size-4.5" />
            </button>
          );
        })}
      </div>

      <Modal
        open={open !== null}
        onClose={() => setOpen(null)}
        title={
          <span className="flex items-center gap-2">
            {open ? <ToolIcon id={open} /> : null}
            {open ? TOOL_META[open].title : ""}
          </span>
        }
      >
        {open ? bodies[open] : null}
      </Modal>
    </>
  );
}

function ToolIcon({ id }: { id: ToolId }) {
  const { Icon } = TOOL_META[id];
  return <Icon aria-hidden className="size-5 shrink-0 text-ink-faint" />;
}
