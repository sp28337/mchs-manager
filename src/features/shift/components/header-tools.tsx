"use client";

import { Save, Settings2, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils/cn";

import type { StoredProfile } from "../storage/profile";
import { useSaveToFile } from "./save-to-file";
import { SettingsPanel } from "./settings-panel";

/**
 * Настройки и выгрузка — из шапки.
 *
 * --- Почему не колонкой сбоку --------------------------------------------
 *
 * Колонка была: слева ввод, справа вывод. Она честно работала, но платила
 * за это девятнадцатью ремами ширины — у графика на год и двенадцати
 * календарных сеток это самое дорогое, что можно отнять.
 *
 * Из того, что в ней стояло, почти всё нашло себе место ближе к делу:
 * период переехал в панель над сеткой, которой он и управляет, отпуска и
 * выходы помимо графика вносятся нажатием по самому дню, а ответы анкеты
 * — дата смены, норма, время её начала — ушли в настройки. В шапке осталось два действия:
 * открыть настройки и выгрузить профиль в файл.
 *
 * --- Почему в окне, а не выпадающим списком ------------------------------
 *
 * В настройках форма из десятка полей. Выпадающая панель такого размера —
 * то же модальное окно, только без перехвата фокуса и без Esc. Родной
 * `dialog` даёт и то и другое.
 *
 * --- Почему на узком экране остаются значки ------------------------------
 *
 * Кнопок стало две, и в меню их сворачивать больше незачем: два значка
 * занимают меньше места, чем один значок меню, и ведут прямо к делу, а не
 * к списку из двух пунктов. Подписи появляются, как только для них
 * хватает ширины, — порог назначен замером и стоит в `LABELS_FROM`.
 */

type ToolId = "settings" | "save";

/**
 * Подпись на кнопке и имя для программы чтения — разные строки.
 *
 * На кнопке нужно короткое имя: их две в ряд, и рядом ещё знак с
 * названием сайта. Имя, которое произносит диктор, называет действие
 * целиком — «Сохранить в файл» вместо «Сохранить».
 */
const TOOL_META: Record<ToolId, { label: string; title: string; Icon: LucideIcon }> = {
  settings: { label: "Настройки", title: "Настройки", Icon: Settings2 },
  save: { label: "Сохранить", title: "Сохранить в файл", Icon: Save },
};

const TOOL_ORDER: readonly ToolId[] = ["settings", "save"];

/**
 * С какой ширины у кнопок появляются подписи.
 *
 * Замером: знак, две плашки с подписями и поля страницы занимают около
 * четырёхсот двадцати точек. Порог `xs` (448) даёт запас и не ломает
 * шапку на двух строках ни на одном телефоне.
 */
const LABELS_FROM = "hidden xs:inline";

export function HeaderTools({
  profile,
  onChange,
  className,
}: {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const save = useSaveToFile(profile);

  return (
    <>
      <div
        role="group"
        aria-label="Настройки и выгрузка"
        className={cn("flex items-center gap-2", className)}
      >
        {TOOL_ORDER.map((id) => {
          const { label, title, Icon } = TOOL_META[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => (id === "save" ? save.ask() : setOpen(true))}
              // Имя кнопки не зависит от того, видна подпись или нет:
              // на узком экране от кнопки остаётся значок, и без имени она
              // стала бы для программы чтения безымянной.
              aria-label={title}
              title={title}
              className={cn(
                "inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-xl",
                "bg-paper-raised px-3 text-sm font-medium",
                "text-ink transition-colors hover:bg-paper-sunken",
                "focus-visible:outline-2 focus-visible:outline-offset-2",
                "focus-visible:outline-trace",
              )}
            >
              <Icon aria-hidden className="size-4.5 shrink-0 text-ink-muted" />
              <span className={LABELS_FROM}>{label}</span>
            </button>
          );
        })}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <Settings2 aria-hidden className="size-5 shrink-0 text-ink-faint" />
            Настройки
          </span>
        }
      >
        <SettingsPanel profile={profile} onChange={onChange} />
      </Modal>

      {save.dialog}
    </>
  );
}
