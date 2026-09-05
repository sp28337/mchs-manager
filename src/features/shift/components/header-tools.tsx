"use client";

import { FolderOpen, Save, Settings, X, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { Materialize } from "@/components/ui/materialize";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils/cn";

import type { StoredProfile } from "../storage/profile";
import { useOpenProfile } from "./open-profile";
import { useSaveToFile } from "./save-to-file";
import type { IsoDate } from "../domain/plain-date";
import { SettingsTabs } from "./settings-tabs";

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
 * — дата смены, норма, время её начала — ушли в настройки.
 *
 * --- Почему в шапке три кнопки, а не две ---------------------------------
 *
 * Действий у профиля ровно три, и они одного рода: настроить нынешний,
 * открыть другой, сохранить нынешний. Два стояли здесь, третье — выбор
 * файла — лежало на дне настроек, четырьмя строками с пояснением, безо
 * всякой причины, кроме той, что когда-то оно завелось в окне создания
 * профиля и осталось жить рядом.
 *
 * Теперь они в ряд и в том порядке, в каком читается история профиля:
 * настроить, открыть, сохранить. Открыть стоит посередине намеренно —
 * это единственное действие, уносящее нынешний профиль, и соседство с
 * «Сохранить» справа тут кстати.
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
 * --- Настройки на телефоне: не окно вовсе ---------------------------------
 *
 * Ниже `sm` кнопка «Настройки» не открывает `Modal`: она переключает то,
 * что показано на самой странице (`workspace.tsx` решает, что́ именно, —
 * знак сайта рядом читает «Настройки» вместо «График 1 3», полоса цифр
 * становится закладками, календарь — анкетой). Экран не сменился ни на
 * миг, и открывать его окном означало бы утверждать обратное.
 *
 * Значок кнопки при этом меняется сам, шестерня на крестик: та же кнопка,
 * которой открыли, и закрывает. Отдельного крестика в углу листа, как у
 * прежнего окна, тут нет и не может быть — самого листа больше нет.
 *
 * На столе ширины хватает, и там кнопка ведёт себя как раньше — открывает
 * `Modal`, обычное плавающее окно. Настройки в нём не выглядят частью
 * страницы, но там и не нужно: колонки и панели по бокам никуда не
 * прячутся, а окно посередине лишь дополняет их.
 */

type ToolId = "settings" | "open" | "save";

/**
 * Подпись на кнопке и имя для программы чтения — разные строки.
 *
 * На кнопке нужно короткое имя: их две в ряд, и рядом ещё знак с
 * названием сайта. Имя, которое произносит диктор, называет действие
 * целиком — «Сохранить в файл» вместо «Сохранить».
 */
const TOOL_META: Record<ToolId, { label: string; title: string; Icon: LucideIcon }> = {
  settings: { label: "Настройки", title: "Настройки", Icon: Settings },
  open: { label: "Открыть", title: "Открыть профиль из файла", Icon: FolderOpen },
  save: { label: "Сохранить", title: "Сохранить в файл", Icon: Save },
};

export const TOOL_ORDER: readonly ToolId[] = ["settings", "open", "save"];

/**
 * С какой ширины у кнопок появляются подписи.
 *
 * Замером: знак сайта занимает 170 точек, три плашки с подписями — 372,
 * поля страницы и просветы между ними — ещё 64. Итого 606, и порог `sm`
 * (640) даёт запас в три десятка точек.
 *
 * Порог был `xs` (448), пока кнопок было две. С третьей на этой ширине
 * шапка перестала помещаться в строку — а переносить её нельзя, строка
 * одна: см. `site-header.tsx`. Поэтому подписи теперь уходят раньше, зато
 * значки остаются все три и на самом узком телефоне.
 *
 * Вынесен наружу: ту же лестницу повторяют кости заглушки
 * (`workspace-skeleton.tsx`), и разойтись им нельзя — иначе на 500 точках
 * кость окажется вдвое шире кнопки, которая её сменит.
 */
export const LABELS_FROM = "hidden sm:inline";

export function HeaderTools({
  profile,
  onChange,
  onForget,
  onOpenDay,
  className,
  isMobile,
  mobileSettingsOpen,
  onToggleMobileSettings,
}: {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  /** Удалить профиль с устройства — из настроек, рядом со сбросом. */
  onForget?: () => void;
  /**
   * Открыть сутки на сетке.
   *
   * Нужно перечню внесённых изменений: строка перечня ведёт в те самые
   * сутки, а открывает их рабочий экран — там же, где и всё остальное.
   * Заводить второе окно дня внутри настроек значило бы повторить его
   * целиком и разойтись с ним при первой же правке.
   */
  onOpenDay: (day: IsoDate, grid: "shifts" | "calendar") => void;
  className?: string;
  /** Ширина экрана ниже `sm` — там у настроек нет своего окна. */
  isMobile: boolean;
  /** Показаны ли сейчас настройки вместо страницы. Имеет смысл только на телефоне. */
  mobileSettingsOpen: boolean;
  onToggleMobileSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const save = useSaveToFile(profile);
  // Открытый файл ЗАМЕЩАЕТ профиль целиком, а не правит его по полю:
  // прежнего в нём не остаётся ничего.
  const file = useOpenProfile(profile, (next) => onChange(() => next));

  return (
    <>
      <div
        role="group"
        aria-label="Профиль: настройки, открыть, сохранить"
        className={cn("flex items-center gap-2", className)}
      >
        {TOOL_ORDER.map((id) => {
          const { label, title, Icon } = TOOL_META[id];
          // Кнопка настроек на телефоне не открывает окно — она переключает
          // страницу и сама превращается в кнопку закрытия. Имя и подсказка
          // называют то действие, которое нажатие СЕЙЧАС совершит.
          const toggling = id === "settings" && isMobile;
          const pressed = toggling && mobileSettingsOpen;
          const label_ = pressed ? "Закрыть" : label;
          const title_ = pressed ? "Закрыть настройки" : title;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (id === "save") save.ask();
                else if (id === "open") file.ask();
                else if (isMobile) onToggleMobileSettings();
                else setOpen(true);
              }}
              // Имя кнопки не зависит от того, видна подпись или нет:
              // на узком экране от кнопки остаётся значок, и без имени она
              // стала бы для программы чтения безымянной.
              aria-label={title_}
              aria-expanded={toggling ? mobileSettingsOpen : undefined}
              title={title_}
              className={cn(
                // `lit` — кнопка ловит свет лампы. Стоит она у правого
                // края, дальше конца трубки, и блик ложится не сверху, а
                // по верхней и левой кромке: сторону считает сама лампа
                // замером (`shared/lamp.tsx`).
                "lit",
                "inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-xl",
                "bg-paper-raised px-3 text-sm font-medium",
                "text-ink transition-colors hover:bg-paper-sunken",
                "focus-visible:outline-2 focus-visible:outline-offset-2",
                "focus-visible:outline-trace",
              )}
            >
              {toggling ? (
                // Шестерня и крестик стоят в одной ячейке грида и проступают
                // друг в друга — тот же приём, что у слова рядом со знаком
                // сайта (`site-header.tsx`): один толкует то же самое
                // действие («настройки»/«закрыть»), не сдвигая соседей.
                <span className="grid">
                  <Materialize
                    show={!pressed}
                    durationClassName="duration-200"
                    className="col-start-1 row-start-1"
                  >
                    <Icon aria-hidden className="size-4.5 shrink-0 text-ink-muted" />
                  </Materialize>
                  <Materialize
                    show={pressed}
                    durationClassName="duration-200"
                    className="col-start-1 row-start-1"
                  >
                    <X aria-hidden className="size-4.5 shrink-0 text-ink-muted" />
                  </Materialize>
                </span>
              ) : (
                <Icon aria-hidden className="size-4.5 shrink-0 text-ink-muted" />
              )}
              <span className={LABELS_FROM}>{label_}</span>
            </button>
          );
        })}
      </div>

      {/* Окно — только на столе: на телефоне у кнопки настроек другая
          работа, см. шапку файла. */}
      <Modal open={open} onClose={() => setOpen(false)} title="Настройки">
        <SettingsTabs
          profile={profile}
          onChange={onChange}
          onForget={onForget}
          // Открыть сутки — значит закрыть настройки: окно дня встаёт
          // поверх, и оставить под ним второе окно значило бы вернуть
          // человека в настройки, как только он закончит с днём.
          onOpenDay={(day, grid) => {
            setOpen(false);
            onOpenDay(day, grid);
          }}
        />
      </Modal>

      {save.dialog}
      {file.dialogs}
    </>
  );
}
