"use client";

import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils/cn";

import {
  DEFAULT_SCHEDULE_PATTERN,
  schedulePatternOf,
} from "../domain/schedule-pattern";
import { DEFAULT_SHIFT_START } from "../domain/shift-hours";
import { todayIso } from "../domain/plain-date";
import { weeklyNormGroundFacts } from "../model/derive";
import {
  createProfile,
  importProfile,
  DEFAULT_PROFILE_NAME,
  type StoredProfile,
} from "../storage/profile";
import { SettingsPanel } from "./settings-panel";

/**
 * Окно «Создать профиль».
 *
 * --- Почему окно, а не страница с формой ----------------------------------
 *
 * У страницы-анкеты была своя вёрстка тех же вопросов — норма списком с
 * абзацем пояснения, время отсчёта смены отдельным полем. Настройки
 * спрашивают то же самое, и две формы на одни вопросы неизбежно
 * расходятся: пояснение поправили в одной, а человек читает другую.
 *
 * Поэтому вопросы одни, в одном компоненте (`SettingsPanel`), и
 * открываются так же, как из шапки, — окном. Разница только в заголовке:
 * «Создать профиль» вместо «Настроек», и внизу кнопка, которой профиль
 * заводится.
 *
 * --- Почему окно открывается на ГЛАВНОЙ ------------------------------------
 *
 * Раньше кнопка первого экрана вела на `/calculator`, а тот, не найдя
 * профиля, показывал ту же главную с окном поверх. Человек нажимал кнопку
 * и попадал на страницу, которая выглядит как та, с которой он ушёл, — с
 * другим адресом и без единого признака, что он куда-то перешёл. Закрыв
 * окно, он оставался на странице расчёта без расчёта.
 *
 * Теперь окно открывается там, где нажали, и никуда не ведёт. В расчёт
 * человек попадает, когда профиль создан, — то есть когда там есть что
 * показывать.
 *
 * --- Почему возврат из файла тоже в окне -----------------------------------
 *
 * Он отвечает на тот же вопрос — «откуда взять профиль», — только другим
 * способом: не заполнять заново, а вернуть сохранённый. Оставить его на
 * странице значило бы спрятать за окном единственный выход для того, кто
 * уже всё это однажды заполнял.
 *
 * --- Почему черновик, а не поля по одному ----------------------------------
 *
 * `SettingsPanel` правит профиль, а не набор полей. Поэтому здесь лежит
 * готовый профиль с умолчаниями, панель правит его, а кнопка сохраняет.
 * Заодно исчезает разнобой умолчаний: то, что подставлено в черновике, и
 * есть то, что человек увидит в настройках потом.
 */

const CURRENT_YEAR = new Date().getUTCFullYear();

/** Профиль, каким он будет, если человек не тронет ни одного поля. */
export function blankProfile(): StoredProfile {
  return createProfile({
    displayName: "",
    // Норма приходит одним ответом: человек выбирает основание, а признаки,
    // которые из него следуют, раскладываются по профилю здесь.
    ...weeklyNormGroundFacts("base"),
    // Сегодня — единственная дата, о которой точно известно, что человек её
    // помнит. Свою смену он отмерит от неё.
    firstShiftDate: todayIso(),
    accountingYear: CURRENT_YEAR,
    shiftStartTime: DEFAULT_SHIFT_START,
    // График и продолжительность смены идут парой: второе следует из
    // первого, и подставляются они вместе — здесь и при каждой смене
    // графика в настройках.
    schedulePattern: DEFAULT_SCHEDULE_PATTERN,
    shiftDurationHours: schedulePatternOf(DEFAULT_SCHEDULE_PATTERN).defaultShiftHours,
    // Свой цикл заполнен и у того, кто его не выбирал: числа хранятся
    // всегда, чтобы не пропадать при возврате к заготовке.
    customWorkDays: 1,
    customRestDays: 3,
  });
}

export function CreateProfileModal({
  open,
  onClose,
  onCreated,
  from,
  notice,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (profile: StoredProfile) => void;
  /** Кнопка, которой окно открыли: на телефоне лист вырастает из неё. */
  from?: HTMLElement | null;
  /** Сообщение о нечитаемом профиле, если он был. Место ему — в окне. */
  notice?: ReactNode;
}) {
  const [draft, setDraft] = useState<StoredProfile>(blankProfile);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    try {
      // Пустое имя — не ошибка: обращение нужно человеку, а не расчёту, и
      // отказывать в графике из-за незаполненной строки было бы придиркой.
      onCreated({
        ...draft,
        displayName: draft.displayName.trim() || DEFAULT_PROFILE_NAME,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить профиль.");
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      sheet
      from={from}
      title={<span className="sheet__word">Создать профиль</span>}
    >
      <div className="space-y-5">
        {notice}

        {error ? (
          <p className="rounded-xl bg-signal-soft px-4 py-3 text-sm">{error}</p>
        ) : null}

        <SettingsPanel profile={draft} onChange={setDraft} purpose="create" />

        <div className="space-y-5 pt-4">
          <Button type="button" className="w-full" onClick={submit}>
            Построить мой график
          </Button>

          <ImportBlock onImported={onCreated} />
        </div>
      </div>
    </Modal>
  );
}

/**
 * Возврат из файла.
 *
 * Профиль живёт в браузере, а браузеры чистят. Без этой кнопки
 * единственным способом вернуть свой год после очистки был бы ввод заново
 * — включая все больничные, которые человек уже вспоминал однажды.
 */
function ImportBlock({ onImported }: { onImported: (profile: StoredProfile) => void }) {
  const fileId = useId();
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <section aria-labelledby="restore" className="space-y-2">
      <h3
        id="restore"
        className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted"
      >
        Уже заполняли раньше
      </h3>
      <p className="text-sm text-ink-muted">
        Если вы сохраняли профиль в файл, загрузите его — график, отсутствия и
        правки календаря вернутся как были.
      </p>
      {error ? (
        <p className="rounded-xl bg-signal-soft px-4 py-3 text-sm">{error}</p>
      ) : null}
      {/* Нативная кнопка выбора файла подписана браузером — «Choose File»
          в русском интерфейсе, и поменять эту надпись со страницы нельзя.
          Поэтому само поле скрыто (но доступно с клавиатуры и программе
          чтения), а роль кнопки играет подпись к нему. */}
      <div className="flex flex-wrap items-center gap-3">
        <Label
          htmlFor={fileId}
          className={cn(
            "inline-flex h-9 cursor-pointer items-center rounded-xl border border-rule-strong",
            "bg-paper px-3 text-sm font-normal",
            "hover:border-ink focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-trace",
          )}
        >
          Выбрать файл профиля
        </Label>
        <input
          id={fileId}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setFileName(file.name);
            setError(null);
            try {
              onImported(importProfile(await file.text()));
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Файл не прочитан.");
            }
          }}
        />
        <span className="text-sm text-ink-muted" aria-live="polite">
          {fileName ?? "Файл не выбран"}
        </span>
      </div>
    </section>
  );
}
