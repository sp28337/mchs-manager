"use client";

import { ListChecks, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, Field } from "@/components/ui/panel";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";

import type { IsoDate } from "../domain/plain-date";
import { profileNeedsExport, type StoredProfile } from "../storage/profile";
import { ChangesList } from "./changes-list";
import { ImportProfileBlock } from "./import-profile";
import { SettingsPanel } from "./settings-panel";

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
  onReplace,
  onOpenDay,
}: {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  onForget?: () => void;
  /** Открыть вместо нынешнего профиль из файла. */
  onReplace: (profile: StoredProfile) => void;
  /** Открыть сутки на сетке — и закрыть настройки, чтобы их было видно. */
  onOpenDay: (day: IsoDate, grid: "shifts" | "calendar") => void;
}) {
  const [tab, setTab] = useState<Tab>("profile");
  const [warning, setWarning] = useState(false);
  const [allowed, setAllowed] = useState(false);

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
            onClick={() => setTab(id)}
            className="grow"
          >
            <Icon aria-hidden />
            {label}
          </SegmentedItem>
        ))}
      </Segmented>

      {tab === "profile" ? (
        <div className="space-y-4">
          <SettingsPanel profile={profile} onChange={onChange} onForget={onForget} />

          <Card>
            <Field label="" stack>
              <ImportProfileBlock
                title="Другой профиль"
                onImported={onReplace}
                // Разрешение спрашивается до открытия выбора файла — и
                // только если нынешнее состояние ещё не унесено в файл.
                // Спрашивать всегда значило бы задавать вопрос, ответ на
                // который человек уже дал, нажав «Сохранить в файл».
                onPick={() => {
                  if (allowed || !profileNeedsExport(profile)) return true;
                  setWarning(true);
                  return false;
                }}
              >
                Открыть файл с другим графиком. Нынешний профиль на этом
                устройстве будет заменён.
              </ImportProfileBlock>
            </Field>
          </Card>
        </div>
      ) : (
        <ChangesList profile={profile} onChange={onChange} onOpenDay={onOpenDay} />
      )}

      {/* Предупреждение, а не запрет: человек вправе заменить профиль,
          не сохраняя, — но не вправе сделать это, не зная. */}
      <ConfirmDialog
        open={warning}
        onClose={() => setWarning(false)}
        onConfirm={() => setAllowed(true)}
        title="Нынешний профиль не сохранён"
        confirm="Всё равно открыть"
        destructive
      >
        <p>
          С последней правки график не сохранялся в файл. Открыв другой
          профиль, вы замените нынешний — вместе с отпусками, больничными и
          всем, что отмечено на сетках.
        </p>
        <p className="text-ink-muted">
          Отменить будет нельзя: данные лежат только на этом устройстве, копии
          на сервере нет. Сохранить нынешний график можно кнопкой в шапке — она
          рядом с настройками.
        </p>
      </ConfirmDialog>
    </div>
  );
}
