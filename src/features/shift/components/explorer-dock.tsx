"use client";

import { FolderPlus, Plus, Upload, type LucideIcon } from "lucide-react";

import { MARK_EMPTY_CLASS } from "@/components/shared/header-action";
import { KNOB, KNOB_ICON, KNOB_NEST, KnobLabel } from "@/components/ui/knob";
import { ThemeCorner } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils/cn";

import { DOCK, DOCK_RIGHT_EXPLORER } from "./grid-dock";
import type { ExplorerTools } from "./profile-explorer";

/**
 * Знаки проводника: «Папка», «График», «Из файла» и тема.
 *
 * --- Почему знаки, а не плашки в строке пути -------------------------------
 *
 * Три действия стояли плашками справа от пути до открытой папки — со
 * значком и словом, на подложке цвета бумаги, — то есть на языке, которым
 * на странице говорит только проводник. Всё остальное управление экраном —
 * легенда, график, календарь, год, «Онлайн» — стоит знаками без подложки у
 * нижней кромки (`grid-dock.tsx`). Два языка на двух экранах одного
 * приложения: человек, привыкший нажимать знак в углу, на проводнике
 * искал плашки в строке над списком.
 *
 * Теперь тот же язык: знаки без подложки у нижней кромки, подпись выезжает
 * при наведении (`ui/knob.tsx`). С `md` они стоят колонкой у правого края,
 * над знаком темы, в поле, которое оставляет суженная рамка списка
 * (`.frame-inset` в `globals.css`); на телефоне — рядом с темой полосой от
 * края до края.
 *
 * Над темой, а не у левого края, как у календаря: действия проводника —
 * создать и загрузить — относятся к самому окну так же, как тема, и правая
 * колонка уже есть у календаря (масштаб над темой). От темы они отступают на
 * одну клетку знака, как масштаб календаря: тема остаётся отдельным знаком, а
 * не пятым в столбике. Подпись выезжает влево — справа кромка окна.
 *
 * Порядок: в разметке — «Папка», «График», «Из файла»; на телефоне они идут
 * слева направо, а в колонке — снизу вверх, так что «Папка» стоит ближе всего
 * к теме.
 *
 * --- Почему состояние не здесь ---------------------------------------------
 *
 * Что сейчас делается — завели папку, открыто окно создания — знает сам
 * проводник и читает рабочий экран (`ExplorerTools`). Знаки только
 * нажимаются: действие приходит готовое.
 */
export function ExplorerDock({ tools }: { tools: ExplorerTools }) {
  return (
    <div role="group" aria-label="Действия со списком графиков" className={DOCK}>
      <div className={DOCK_RIGHT_EXPLORER}>
        {/* `md:mb-11` — пусто на одну клетку знака (44 точки) до темы, как у
            колонки масштаба в календаре (`SCALE_KNOBS`). На телефоне группа
            раскрыта в общий ряд, и отступа там нет. */}
        <div className="max-md:contents md:mb-11 md:flex md:flex-col-reverse md:items-end">
          <ActionKnob
            icon={FolderPlus}
            name="Создать папку"
            caption="Папка"
            onClick={tools.newFolder}
          />
          <ActionKnob
            icon={Plus}
            name="Создать график"
            caption="График"
            onClick={tools.newProfile}
          />
          <ActionKnob
            icon={Upload}
            name="Загрузить график из файла"
            caption="Из файла"
            onClick={tools.importFile}
          />
        </div>

        <ThemeCorner docked />
      </div>
    </div>
  );
}

/** Одно действие: значок без плашки и подпись, выезжающая при наведении. */
function ActionKnob({
  icon: Icon,
  name,
  caption,
  onClick,
}: {
  icon: LucideIcon;
  /** Имя для программы чтения — что сделает нажатие. */
  name: string;
  /** Подпись, выезжающая при наведении. */
  caption: string;
  onClick: () => void;
}) {
  return (
    <div className={cn(KNOB_NEST, "justify-end")}>
      <button type="button" aria-label={name} onClick={onClick} className={KNOB}>
        {/* Подпись — слева: справа у знака кромка окна. Перед значком в
            разметке, чтобы значок стоял на месте, а подпись росла от него
            (`KnobLabel`). */}
        <KnobLabel side="left">{caption}</KnobLabel>
        {/* Цвет — ровно тот же, что у знаков календаря и темы: «пустые»
            части знака сайта (`MARK_EMPTY_CLASS`). Знаки проводника стоят
            рядом с ними одним набором, и любой иной полутон читался бы как
            знаки из разных мест. */}
        <span className={cn(KNOB_ICON, MARK_EMPTY_CLASS)}>
          <Icon aria-hidden />
        </span>
      </button>
    </div>
  );
}
