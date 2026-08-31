"use client";

import { ListChecks, Save, SlidersHorizontal } from "lucide-react";
import { useRef, useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, Field } from "@/components/ui/panel";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";

import type { IsoDate } from "../domain/plain-date";
import { profileNeedsExport, type StoredProfile } from "../storage/profile";
import { useSaveToFile } from "./save-to-file";
import { ChangesList } from "./changes-list";
import { ImportProfileBlock } from "./import-profile";
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
  // Та же выгрузка, что и в шапке: один крючок на оба места, поэтому и окно
  // с именем файла, и само сохранение здесь ровно те же.
  const save = useSaveToFile(profile, { over: true });

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

          {/* «Удалить профиль» — здесь, а не под перечнем изменений.
              -------------------------------------------------------------
              Оно стирает не отметки, а САМ ПРОФИЛЬ: имя, график, норму,
              дату смены — всё то, о чём спрашивает эта закладка. Стоя под
              перечнем правок, оно обещало убрать правки, а убирало анкету.

              Место у него последнее и сразу за «другим профилем»: обе
              кнопки об одном — покончить с нынешним профилем, — только
              одна взамен даёт другой, а вторая не даёт ничего. Сброс
              календаря остался в изменениях: он стирает ровно то, что там
              перечислено. */}
          <DangerActions onForget={onForget} onChange={onChange} showReset={false} />
        </div>
      ) : (
        <ChangesList profile={profile} onChange={onChange} onOpenDay={onOpenDay} />
      )}
      </div>

      {/* Окно не просто предупреждает, а ПРЕДЛАГАЕТ выход.
          -------------------------------------------------------------
          Сперва оно говорило «сохранить можно кнопкой в шапке» — то есть
          отправляло человека искать по экрану кнопку, о которой само же и
          вспомнило. Теперь сохранение стоит прямо здесь, главным действием,
          и это ТА ЖЕ САМАЯ кнопка, что в шапке: тот же крючок, то же окно с
          именем файла, тот же знак. Своя укороченная выгрузка тут уже была —
          она уносила файл молча, не спросив имени, — и человек получал от
          одинаково подписанных кнопок разное поведение.

          Отдельной «Отмены» у окна нет, и это не упущение. Вопрос здесь не
          «делать?», а «сначала сохранить?»: отказ от него — не бездействие,
          а второй путь, открыть не сохраняя. «Отмена» на его месте
          обманывала бы — её нажимают, чтобы ничего не произошло. Ничего не
          делать по-прежнему можно крестиком и клавишей Esc.

          Открыть без сохранения человек вправе: это предупреждение, а не
          запрет. Но путь этот второй и без нажима. */}
      <ConfirmDialog
        open={warning}
        onClose={() => setWarning(false)}
        // Разрешения на замену это НЕ даёт, и не должно: человек может
        // передумать прямо в окне с именем файла. Разрешение появится само
        // — когда файл действительно уйдёт: `downloadProfile` ставит
        // отметку о выгрузке, и `profileNeedsExport` перестаёт возражать.
        onConfirm={save.ask}
        title="Сначала сохранить нынешний?"
        confirm="Сохранить в файл"
        icon={<Save aria-hidden />}
        decline={{
          label: "Открыть без сохранения",
          onClick: () => setAllowed(true),
        }}
      >
        <p>
          С последней правки график не сохранялся в файл. Открыв другой
          профиль, вы замените нынешний — вместе с отпусками, больничными и
          всем, что отмечено на сетках.
        </p>
        <p className="text-ink-muted">
          Отменить будет нельзя: данные лежат только на этом устройстве, копии
          на сервере нет.
        </p>
      </ConfirmDialog>

      {save.dialog}
    </div>
  );
}
