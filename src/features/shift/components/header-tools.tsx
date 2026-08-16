"use client";

import { Banknote, Menu, Save, Settings2, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Modal } from "@/components/ui/modal";
import { useAnchoredPosition } from "@/lib/hooks/use-anchored-position";
import { cn } from "@/lib/utils/cn";

import type { PeriodCalculation } from "../domain/calculation";
import type { OvertimePayEstimate } from "../domain/overtime-pay";
import type { StoredProfile } from "../storage/profile";
import { OvertimePayCard } from "./overtime-pay-card";
import { saveProfileToFile } from "./save-to-file";
import { SettingsPanel } from "./settings-panel";

/**
 * Настройки, деньги и выгрузка — из шапки.
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
 * в шапке, там же, где выгрузка в файл: видно всегда, не занимает ничего.
 *
 * --- Почему в окне, а не выпадающим списком ------------------------------
 *
 * В обоих блоках форма: восемь полей в одном, поле и разбор суммы в
 * другом. Выпадающая панель такого размера — то же модальное окно, только
 * без перехвата фокуса и без Esc. Родной `dialog` даёт и то и другое.
 *
 * --- Почему на телефоне это одна кнопка ----------------------------------
 *
 * Три плашки с подписями в узкую шапку не встают, а без подписей это три
 * значка подряд, каждый из которых приходится угадывать. Свёрнутые в одну
 * кнопку, они занимают место одного значка и раскрываются списком, где у
 * каждого действия написано имя целиком.
 *
 * Порог — `md`, и назначен он замером: три плашки с подписями занимают
 * 433 точки, и вместе со знаком и именем человека они встают начиная с
 * 768. Ниже меню появляется ВМЕСТО всего ряда, а не рядом с ним.
 */

type ToolId = "pay" | "settings" | "save";

/**
 * Подпись на кнопке и заголовок окна — разные строки.
 *
 * На кнопке в шапке нужно короткое имя: их там три в ряд, и помещаются
 * они только короткими. В заголовке окна, наоборот, место есть, и вопрос
 * называется целиком — «Сколько это в деньгах» отвечает человеку, что он
 * открыл, а «В деньгах» на пустом окне читалось бы обрывком.
 */
const TOOL_META: Record<ToolId, { label: string; title: string; Icon: LucideIcon }> = {
  pay: { label: "В деньгах", title: "Сколько это в деньгах", Icon: Banknote },
  settings: { label: "Настройки", title: "Настройки", Icon: Settings2 },
  save: { label: "Сохранить в файл", title: "Сохранить в файл", Icon: Save },
};

const TOOL_ORDER: readonly ToolId[] = ["pay", "settings", "save"];

/** Ширина выпадающего меню: по самой длинной подписи. */
const MENU_WIDTH = 232;

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
  const [open, setOpen] = useState<Exclude<ToolId, "save"> | null>(null);
  const [menu, setMenu] = useState(false);

  const bodies: Record<Exclude<ToolId, "save">, ReactNode> = {
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

  // Выгрузка — единственное действие, которое ничего не открывает: оно
  // происходит и заканчивается.
  function run(id: ToolId) {
    setMenu(false);
    if (id === "save") saveProfileToFile(profile);
    else setOpen(id);
  }

  return (
    <>
      <div
        role="group"
        aria-label="Настройки и расчёт"
        className={cn("hidden items-center gap-2 md:flex", className)}
      >
        {TOOL_ORDER.map((id) => {
          const { label, title, Icon } = TOOL_META[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => run(id)}
              // Имя кнопки — полное, а не то, что на ней написано: «В
              // деньгах» вслух ничего не значит.
              aria-label={title}
              title={title}
              className={cn(
                "inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-xl",
                "border border-rule-strong bg-paper-raised px-3 text-sm font-medium",
                "text-ink transition-colors hover:bg-paper-sunken",
                "focus-visible:outline-2 focus-visible:outline-offset-2",
                "focus-visible:outline-trace",
              )}
            >
              <Icon aria-hidden className="size-4.5 shrink-0 text-ink-muted" />
              {label}
            </button>
          );
        })}
      </div>

      <ToolsMenu open={menu} onOpen={setMenu} onPick={run} className="md:hidden" />

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

/**
 * Те же три действия одной кнопкой.
 *
 * Слой позиционируется от окна (`fixed`), как подсказки: шапка
 * закреплена, и обычный `absolute` внутри неё обрезался бы её высотой.
 */
function ToolsMenu({
  open,
  onOpen,
  onPick,
  className,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  onPick: (id: ToolId) => void;
  className?: string;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const place = useAnchoredPosition(open, trigger, {
    width: MENU_WIDTH,
    align: "right",
    gap: 6,
  });

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) onOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpen(false);
        trigger.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpen]);

  return (
    <div ref={wrapper} className={cn("relative", className)}>
      <button
        ref={trigger}
        type="button"
        aria-label="Меню"
        aria-expanded={open}
        title="Меню"
        onClick={() => onOpen(!open)}
        className={cn(
          "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl",
          "border border-rule-strong bg-paper-raised text-ink transition-colors",
          "hover:bg-paper-sunken focus-visible:outline-2 focus-visible:outline-offset-2",
          "focus-visible:outline-trace",
        )}
      >
        {open ? (
          <X aria-hidden className="size-5" />
        ) : (
          <Menu aria-hidden className="size-5" />
        )}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Настройки и расчёт"
          style={{
            top: place?.top ?? 0,
            left: place?.left ?? 0,
            width: MENU_WIDTH,
            visibility: place ? "visible" : "hidden",
          }}
          className={cn(
            "fixed z-100 flex flex-col rounded-xl border border-rule-strong",
            "bg-paper-raised p-1 shadow-lg",
          )}
        >
          {TOOL_ORDER.map((id) => {
            const { title, Icon } = TOOL_META[id];
            return (
              <button
                key={id}
                type="button"
                role="menuitem"
                onClick={() => onPick(id)}
                className={cn(
                  "flex h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-left",
                  "text-sm text-ink transition-colors hover:bg-paper-sunken",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2",
                  "focus-visible:outline-trace",
                )}
              >
                <Icon aria-hidden className="size-4.5 shrink-0 text-ink-muted" />
                {title}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ToolIcon({ id }: { id: ToolId }) {
  const { Icon } = TOOL_META[id];
  return <Icon aria-hidden className="size-5 shrink-0 text-ink-faint" />;
}
