"use client";

import { ListChecks, SlidersHorizontal } from "lucide-react";
import { useRef, useState } from "react";

import { Segmented, SegmentedItem } from "@/components/ui/segmented";

import type { IsoDate } from "../domain/plain-date";
import type { StoredProfile } from "../storage/profile";
import { ChangesList } from "./changes-list";
import { DangerActions, SettingsPanel } from "./settings-panel";

/**
 * Настройки на двух закладках.
 *
 * --- Почему закладки, а не один свиток ------------------------------------
 *
 * В окне настроек лежат две вещи разной природы. Первая — ответы анкеты:
 * кто человек, по какому графику работает, с какого числа. Их правят
 * редко и по одному. Вторая — всё, что он отметил на сетках за год:
 * отпуска, больничные, вызовы, переносы смен. Их накапливается два
 * десятка, и смотрят на них не тогда же и не за тем же.
 *
 * Сложенные в один свиток, они мешают друг другу: за анкетой приходится
 * прокручивать перечень, а за перечнем — анкету. Закладки разводят их по
 * двум ответам на вопрос «зачем я сюда открыл»: поправить себя или
 * посмотреть, что наотмечал.
 *
 * --- Почему переключатель, а не вкладки с подчёркиванием -------------------
 *
 * Тот же `Segmented`, что в переключателе сеток и учётного периода. Своя
 * форма вкладок означала бы второй способ выбирать одно из нескольких на
 * одном экране — и человеку пришлось бы узнавать её отдельно.
 */

type Tab = "profile" | "changes";

const TABS: { id: Tab; label: string; Icon: typeof SlidersHorizontal }[] = [
  { id: "profile", label: "Настройки профиля", Icon: SlidersHorizontal },
  { id: "changes", label: "Внесённые изменения", Icon: ListChecks },
];

export function SettingsTabs({
  profile,
  onChange,
  onForget,
  onOpenDay,
}: {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  onForget?: () => void;
  /** Открыть сутки на сетке — и закрыть настройки, чтобы их было видно. */
  onOpenDay: (day: IsoDate, grid: "shifts" | "calendar") => void;
}) {
  const [tab, setTab] = useState<Tab>("profile");

  /**
   * Окно не схлопывается при переходе на другую закладку.
   *
   * Закладки разной высоты, и без этого окно на глазах у человека
   * съёживалось под перечень из трёх строк — то есть прыгало ровно в тот
   * момент, когда он ждал не прыжка, а другого содержимого. Хуже того,
   * прыгала и точка, в которую он только что попал пальцем.
   *
   * Поэтому запоминается высота уже показанного и ставится нижней
   * границей. Расти окну это не мешает: граница НИЖНЯЯ, и закладка выше
   * прежней растянет его как обычно.
   */
  const pane = useRef<HTMLDivElement>(null);
  const [floor, setFloor] = useState(0);

  function show(next: Tab) {
    if (next === tab) return;
    setFloor(pane.current?.offsetHeight ?? 0);
    setTab(next);
  }

  return (
    <div className="space-y-4">
      {/* Во всю ширину, а не по содержимому: в окне переключатель стоит
          один, и растянутый на строку он читается как оглавление, а
          прижатый влево — как ещё одна кнопка среди настроек. */}
      <Segmented label="Разделы настроек" className="flex w-full">
        {TABS.map(({ id, label, Icon }) => (
          <SegmentedItem
            key={id}
            active={tab === id}
            onClick={() => show(id)}
            className="grow"
          >
            <Icon aria-hidden />
            {label}
          </SegmentedItem>
        ))}
      </Segmented>

      <div ref={pane} style={floor ? { minHeight: floor } : undefined}>
      {tab === "profile" ? (
        <div className="space-y-4">
          <SettingsPanel profile={profile} onChange={onChange} />

          {/* «Удалить профиль» — здесь, а не под перечнем изменений.
              -------------------------------------------------------------
              Оно стирает не отметки, а САМ ПРОФИЛЬ: имя, график, норму,
              дату смены — всё то, о чём спрашивает эта закладка. Стоя под
              перечнем правок, оно обещало убрать правки, а убирало анкету.
              Сброс календаря остался там: он стирает ровно то, что там
              перечислено.

              Выбора файла рядом больше нет: открыть другой профиль стало
              кнопкой шапки, третьей рядом с настройками и сохранением
              (`open-profile.tsx`). Здесь он лежал четырьмя строками с
              пояснением — на дне окна, которое ради него надо было
              открыть и прокрутить. */}
          <DangerActions onForget={onForget} onChange={onChange} showReset={false} />
        </div>
      ) : (
        <ChangesList profile={profile} onChange={onChange} onOpenDay={onOpenDay} />
      )}
      </div>

    </div>
  );
}
