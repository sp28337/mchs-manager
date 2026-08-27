"use client";

import { Save, Settings2, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

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
 *
 * --- Настройки на телефоне: лист, а не окно ------------------------------
 *
 * Ниже `sm` окно настроек занимает экран целиком, и открывается оно не
 * появлением поверх страницы, а ПЕРЕХОДОМ из шапки: значок настроек
 * уезжает на место знака сайта, знак и кнопки к этому времени гаснут,
 * рядом со значком проступает слово «Настройки», страница под ним
 * заливается бумагой, и на ней поднимаются поля.
 *
 * Так человек видит, ЧТО открылось и откуда: полноэкранное окно, возникшее
 * рывком, на телефоне неотличимо от перехода на другую страницу, и кнопка
 * «назад» браузера кажется правильным способом его закрыть (а она уводит с
 * сайта).
 *
 * Шапку листа рисует сам лист, а не страница: `dialog` живёт в верхнем
 * слое, и шапка страницы под ним недосягаема. Поэтому шапка листа встаёт
 * ровно на её место — та же высота, те же поля, — а настоящая гасится
 * меткой `data-sheet` на корне документа. Отсюда же и замер: путь значка
 * это расстояние от него до знака сайта, и знать его заранее нельзя —
 * ширина экрана и наличие подписей на кнопках меняют его на десятки точек.
 * Замер делается в момент нажатия и уезжает в CSS переменной.
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

  // Путь значка: замеряется в момент нажатия, потому что до нажатия он
  // неизвестен — подписи на кнопках появляются с 448 точек и сдвигают
  // значок вправо на всю ширину слова.
  const icon = useRef<SVGSVGElement>(null);
  const [travel, setTravel] = useState<number | null>(null);

  function openSettings() {
    const from = icon.current?.getBoundingClientRect();
    const to = document.querySelector("[data-brand]")?.getBoundingClientRect();
    // Не замерилось — не беда: без переменной значок просто проступит на
    // своём месте, остальной переход не зависит от неё.
    setTravel(from && to ? Math.round(from.left - to.left) : null);
    setOpen(true);
  }

  // Метка на корне документа: ею лист гасит настоящую шапку и содержимое
  // страницы под собой. Изнутри `dialog` до них не дотянуться — он в
  // верхнем слое, и никакой его потомок не может выбрать соседа страницы.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.dataset.sheet = "settings";
    return () => {
      delete root.dataset.sheet;
    };
  }, [open]);

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
              onClick={() => (id === "save" ? save.ask() : openSettings())}
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
              <Icon
                ref={id === "settings" ? icon : undefined}
                aria-hidden
                className="size-4.5 shrink-0 text-ink-muted"
              />
              <span className={LABELS_FROM}>{label}</span>
            </button>
          );
        })}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        sheet
        style={
          travel === null
            ? undefined
            : ({ "--settings-travel": `${travel}px` } as CSSProperties)
        }
        className="settings-sheet"
        // Шапка листа встаёт на место шапки страницы: та же высота (`h-16`),
        // те же поля (`px-6`), та же вертикальная середина. Отбивки снизу у
        // неё нет — у шапки страницы её тоже нет, а линия на этом месте
        // выдала бы подмену.
        headerClassName="settings-sheet__bar max-sm:h-16 max-sm:items-center max-sm:border-b-0 max-sm:px-6 max-sm:py-0"
        bodyClassName="settings-sheet__body max-sm:px-6"
        title={
          <span className="flex items-center gap-2">
            <Settings2
              aria-hidden
              className="settings-sheet__icon size-5 shrink-0 text-ink-muted"
            />
            <span className="settings-sheet__word">Настройки</span>
          </span>
        }
      >
        <SettingsPanel profile={profile} onChange={onChange} />
      </Modal>

      {save.dialog}
    </>
  );
}
