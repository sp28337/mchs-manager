"use client";

import {
  ChartColumn,
  FolderOpen,
  FolderPlus,
  Plus,
  Save,
  Settings,
  Upload,
  X,
} from "lucide-react";

import { MenuItem } from "@/components/shared/header-menu";

import type { ExplorerTools } from "./profile-explorer";

/**
 * Действия рабочего экрана — строками в меню шапки.
 *
 * --- Что это за действия ---------------------------------------------------
 *
 * Их четыре, и они об одном — о профиле: настроить нынешний, посмотреть,
 * что из заданного вышло, открыть другой, сохранить нынешний в файл.
 * Порядок тот, в каком читается история профиля. «Открыть» стоит третьим
 * намеренно — это единственное действие, уносящее нынешний профиль, и
 * соседство с «Сохранить» тут кстати.
 *
 * --- Почему в меню, а не кнопками в шапке ----------------------------------
 *
 * Кнопками они и были: четыре плашки со значками, подписи с 768 точек,
 * ширина каждого места под самое длинное слово. Строка сходилась ровно до
 * тех пор, пока в шапке не появилась учётная запись: на телефоне четыре
 * кнопки, кружок и название сайта в одну строку не встают, и уступать
 * приходилось названию — от «ГРАФИК 1|3» оставался один логотип.
 *
 * Теперь в шапке один предмет на любом экране (`shared/header-menu.tsx`),
 * и вместе с ним ушёл весь прежний механизм: мерки ширины, стопки слов в
 * одной ячейке грида, порог подписей, подмена значка на крестик. Плата
 * названа вслух: до настроек теперь два нажатия вместо одного.
 *
 * --- Почему ряд подменяется, пока открыт проводник -------------------------
 *
 * Пока на месте графика показан проводник по профилям, действия у
 * страницы другие: не «настроить, посмотреть, открыть, сохранить», а
 * «папка, профиль, из файла, закрыть». Это те же четыре строки меню, и
 * подмена здесь ровно та же, что была у кнопок.
 *
 * --- Почему выгрузка живёт не здесь ----------------------------------------
 *
 * Окно выгрузки (`save-to-file.tsx`) рисует рабочий экран, а сюда
 * приходит только `onSave`: меню закрывается нажатием, и окно,
 * нарисованное внутри него, закрылось бы вместе с ним.
 */
export function WorkspaceMenuItems({
  settingsOpen,
  onToggleSettings,
  statsOpen,
  onToggleStats,
  explorerOpen,
  onToggleExplorer,
  explorerTools,
  onSave,
}: {
  /** Показаны ли сейчас настройки вместо графика. */
  settingsOpen: boolean;
  onToggleSettings: () => void;
  /** Показана ли сейчас статистика за год вместо графика. */
  statsOpen: boolean;
  onToggleStats: () => void;
  /** Показан ли сейчас проводник по профилям вместо календаря. */
  explorerOpen: boolean;
  onToggleExplorer: () => void;
  /** Действия проводника: пока он открыт, они стоят вместо обычных. */
  explorerTools: ExplorerTools;
  /** Открыть окно выгрузки профиля в файл. */
  onSave: () => void;
}) {
  if (explorerOpen) {
    return (
      <>
        <MenuItem icon={FolderPlus} onClick={explorerTools.newFolder}>
          Создать папку
        </MenuItem>
        <MenuItem icon={Plus} onClick={explorerTools.newProfile}>
          Создать профиль
        </MenuItem>
        <MenuItem icon={Upload} onClick={explorerTools.importFile}>
          Загрузить из файла
        </MenuItem>
        <MenuItem icon={X} onClick={onToggleExplorer}>
          Закрыть проводник
        </MenuItem>
      </>
    );
  }

  return (
    <>
      {/* Настройки и статистика не открывают окно, а переключают то, что
          показано на самой странице (`workspace.tsx`), и строка меню
          называет то действие, которое нажатие СЕЙЧАС совершит. */}
      <MenuItem icon={settingsOpen ? X : Settings} onClick={onToggleSettings}>
        {settingsOpen ? "Закрыть настройки" : "Настройки"}
      </MenuItem>
      <MenuItem icon={statsOpen ? X : ChartColumn} onClick={onToggleStats}>
        {statsOpen ? "Закрыть статистику" : "Статистика за год"}
      </MenuItem>
      <MenuItem icon={FolderOpen} onClick={onToggleExplorer}>
        Открыть профиль
      </MenuItem>
      <MenuItem icon={Save} onClick={onSave}>
        Сохранить в файл
      </MenuItem>
    </>
  );
}
