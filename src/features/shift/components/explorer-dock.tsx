"use client";

import { FolderPlus, Plus, type LucideIcon } from "lucide-react";

import { MARK_EMPTY_CLASS } from "@/components/shared/header-action";
import { RailKnob } from "@/components/shared/header-rail";
import { KNOB, KNOB_ICON, KNOB_NEST, KnobLabel } from "@/components/ui/knob";
import { ThemeCorner } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils/cn";

import { DOCK, DOCK_RIGHT_EXPLORER } from "./grid-dock";
import type { ExplorerTools } from "./profile-explorer";

/**
 * Знаки проводника: «Папка», «График» и тема.
 *
 * --- Почему знаки, а не плашки в строке пути -------------------------------
 *
 * Действия стояли плашками справа от пути до открытой папки — со значком и
 * словом, на подложке цвета бумаги, — то есть на языке, которым на странице
 * говорит только проводник. Всё остальное управление экраном — легенда,
 * график, календарь, год, «Онлайн» — стоит знаками без подложки у нижней
 * кромки (`grid-dock.tsx`). Два языка на двух экранах одного приложения:
 * человек, привыкший нажимать знак в углу, на проводнике искал плашки в
 * строке над списком.
 *
 * Теперь тот же язык: знаки без подложки, подпись выезжает при наведении
 * (`ui/knob.tsx`).
 *
 * --- Где они стоят ----------------------------------------------------------
 *
 * С `lg` — в правой колонке под знаками меню (`ExplorerRailKnobs`, их ставит
 * `WorkspaceRail`), через клетку знака от «Сохранить»: действия над списком
 * стоят рядом с остальным управлением экраном, а не в другом его углу. Ниже
 * `lg` колонки меню нет, и они остаются здесь, у нижней кромки: с `md` —
 * колонкой справа, над знаком темы, на телефоне — рядом с темой полосой от края
 * до края. Подпись выезжает влево — справа кромка окна.
 *
 * Кнопки «Из файла» здесь нет: файл загружают в окне создания графика, куда
 * ведёт «График», и там для этого есть своя кнопка «Загрузить из файла». Две
 * кнопки с одним действием были лишними.
 *
 * Порядок: в разметке — «Папка», «График»; на телефоне они идут слева
 * направо, а в колонке у кромки — снизу вверх, так что «Папка» стоит ближе
 * всего к теме. В колонке под меню порядок сверху вниз: «График», «Папка» —
 * тот же, что у кромки, если читать снизу вверх.
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
            раскрыта в общий ряд, и отступа там нет. С `lg` группы здесь нет:
            те же знаки стоят в колонке под меню. */}
        <div className="max-md:contents md:mb-11 md:flex md:flex-col-reverse md:items-end lg:hidden">
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
        </div>

        <ThemeCorner docked />
      </div>
    </div>
  );
}

/**
 * Те же два действия — знаками в колонке под меню (с `lg`).
 *
 * Отдельная группа с тем же составом: у колонки меню свой знак (`RailKnob`) и
 * своё место в разметке (`WorkspaceRail`, `extra`). Подписи короткие, как у
 * знаков у кромки, а имя для программы чтения полное.
 */
export function ExplorerRailKnobs({ tools }: { tools: ExplorerTools }) {
  return (
    <>
      <RailKnob
        icon={Plus}
        label="Создать график"
        caption="График"
        onClick={tools.newProfile}
      />
      <RailKnob
        icon={FolderPlus}
        label="Создать папку"
        caption="Папка"
        onClick={tools.newFolder}
      />
    </>
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
