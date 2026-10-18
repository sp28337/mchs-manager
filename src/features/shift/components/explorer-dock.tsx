"use client";

import { FolderPlus, Plus, Upload, type LucideIcon } from "lucide-react";

import { MARK_EMPTY_CLASS } from "@/components/shared/header-action";
import { KNOB, KNOB_ICON, KNOB_NEST, KnobLabel } from "@/components/ui/knob";
import { ThemeCorner } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils/cn";

import { DOCK, DOCK_LEFT } from "./grid-dock";
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
 * Теперь тот же язык и то же место: знаки встают туда же, куда встают знаки
 * календаря, и ведут себя так же. С `md` — колонкой у левого края, в поле,
 * которое оставляет суженная рамка списка (`.frame-inset` в `globals.css`);
 * на телефоне — рядом с темой полосой от края до края. Подпись выезжает при
 * наведении (`ui/knob.tsx`).
 *
 * Порядок тот же, что у знаков календаря: в разметке — «Папка», «График»,
 * «Из файла»; на телефоне они идут слева направо, а в колонке — снизу вверх,
 * так что «Папка» стоит ближе всего к нижней кромке.
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
      <div className={DOCK_LEFT}>
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
    <div className={KNOB_NEST}>
      <button type="button" aria-label={name} onClick={onClick} className={KNOB}>
        {/* Цвет — ровно тот же, что у знаков календаря и темы: «пустые»
            части знака сайта (`MARK_EMPTY_CLASS`). Знаки проводника стоят
            рядом с ними одним набором, и любой иной полутон читался бы как
            знаки из разных мест. */}
        <span className={cn(KNOB_ICON, MARK_EMPTY_CLASS)}>
          <Icon aria-hidden />
        </span>
        <KnobLabel>{caption}</KnobLabel>
      </button>
    </div>
  );
}
