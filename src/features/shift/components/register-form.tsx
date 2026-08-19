"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils/cn";

import { DEFAULT_SHIFT_START } from "../domain/shift-hours";
import { todayIso } from "../domain/plain-date";
import { weeklyNormGroundFacts } from "../model/derive";
import { createProfile, importProfile, type StoredProfile } from "../storage/profile";
import { SettingsPanel } from "./settings-panel";

/**
 * Экран без профиля: приглашение и окно с вопросами.
 *
 * --- Почему окно, а не страница с формой --------------------------------
 *
 * Здесь была своя страница-анкета: те же вопросы, но собственной вёрсткой
 * — караул кнопками, норма списком с абзацем пояснения под ним, время
 * развода отдельным полем. Настройки спрашивают то же самое, и две формы
 * на одни вопросы неизбежно расходятся: пояснение поправили в одной, а
 * человек читает другую.
 *
 * Теперь вопросы одни, в одном компоненте (`SettingsPanel`), и открываются
 * так же, как из шапки, — окном. Разница только в заголовке: «Создать
 * профиль» вместо «Настройки», и внизу кнопка, которой профиль заводится.
 *
 * --- Почему окно открыто сразу ------------------------------------------
 *
 * Человек пришёл на страницу калькулятора: ему нужен расчёт, а расчёт
 * начинается с ответов. Показать сначала страницу с кнопкой «заполнить»
 * значило бы поставить лишнее нажатие перед единственным возможным
 * действием.
 *
 * Закрыть окно при этом можно — за ним остаётся то, ради чего его стоит
 * закрыть: возврат профиля из файла. Кнопка «Заполнить профиль» открывает
 * окно снова.
 *
 * --- Почему черновик, а не поля по одному -------------------------------
 *
 * `SettingsPanel` правит профиль, а не набор полей. Поэтому здесь лежит
 * готовый профиль с умолчаниями, панель правит его, а кнопка сохраняет.
 * Заодно исчезает разнобой умолчаний: то, что подставлено в черновике, и
 * есть то, что человек увидит в настройках потом.
 */

const CURRENT_YEAR = new Date().getUTCFullYear();

export interface RegisterFormProps {
  onCreated: (profile: StoredProfile) => void;
}

/** Профиль, каким он будет, если человек не тронет ни одного поля. */
function blankProfile(): StoredProfile {
  return createProfile({
    displayName: "",
    // Норма приходит одним ответом: человек выбирает основание, а признаки,
    // которые из него следуют, раскладываются по профилю здесь.
    ...weeklyNormGroundFacts("base"),
    guardNumber: 1,
    // Сегодня — единственная дата, о которой точно известно, что человек её
    // помнит. Свою смену он отмерит от неё.
    firstShiftDate: todayIso(),
    accountingYear: CURRENT_YEAR,
    shiftStartTime: DEFAULT_SHIFT_START,
  });
}

export function RegisterForm({ onCreated }: RegisterFormProps) {
  const [draft, setDraft] = useState<StoredProfile>(blankProfile);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    try {
      // Пустое имя — не ошибка: обращение нужно человеку, а не расчёту, и
      // отказывать в графике из-за незаполненной строки было бы придиркой.
      onCreated({
        ...draft,
        displayName: draft.displayName.trim() || "Пожарный",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить профиль.");
    }
  }

  return (
    <>
      <div className="space-y-8">
        {error ? (
          <p className="max-w-prose rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm">
            {error}
          </p>
        ) : null}

        <Button type="button" onClick={() => setOpen(true)}>
          Заполнить профиль
        </Button>

        <ImportBlock onImported={onCreated} />
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Создать профиль">
        <div className="space-y-5">
          <SettingsPanel profile={draft} onChange={setDraft} purpose="create" />
          <div className="border-t border-rule pt-4">
            <Button type="button" className="w-full" onClick={submit}>
              Построить мой график
            </Button>
          </div>
        </div>
      </Modal>

      <footer className="flex justify-center pt-8 pb-8 md:ml-auto md:pb-2">
        <ThemeToggle/>
      </footer>
    </>
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
    <section aria-labelledby="restore" className="space-y-2 border-t border-rule pt-6">
      <h3 id="restore" className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
        Уже заполняли раньше
      </h3>
      <p className="max-w-prose text-sm text-ink-muted">
        Если вы сохраняли профиль в файл, загрузите его — график, отсутствия и
        правки календаря вернутся как были.
      </p>
      {error ? (
        <p className="max-w-prose rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm">
          {error}
        </p>
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
