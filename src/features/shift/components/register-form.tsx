"use client";

import { useId, useState, type ReactNode } from "react";

import { LandingHero } from "@/components/landing/hero";
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
 * Экран без профиля: главная и окно с вопросами поверх неё.
 *
 * --- Что стоит ЗА окном -------------------------------------------------
 *
 * Главная — тот самый первый экран, с которого человек сюда нажал. Здесь
 * была своя страница «Расскажите о себе»: заголовок, абзац объяснений и
 * блок возврата из файла. Получалось, что нажатие на кнопку открывает
 * незнакомый раздел, а поверх него — ещё и окно; закрыв окно, человек
 * оставался в разделе, которого не просил.
 *
 * Теперь за окном ровно то, что было под курсором мгновение назад.
 * Закрыть окно можно, и человек остаётся на главной; кнопка первого
 * экрана открывает его снова.
 *
 * --- Почему окно, а не страница с формой --------------------------------
 *
 * У страницы-анкеты была своя вёрстка тех же вопросов — норма списком с
 * абзацем пояснения, время отсчёта смены отдельным полем. Настройки
 * спрашивают то же самое, и две формы на одни вопросы неизбежно
 * расходятся: пояснение поправили в одной, а человек читает другую.
 *
 * Теперь вопросы одни, в одном компоненте (`SettingsPanel`), и
 * открываются так же, как из шапки, — окном. Разница только в заголовке:
 * «Создать профиль» вместо «Настроек», и внизу кнопка, которой профиль
 * заводится.
 *
 * --- Почему возврат из файла тоже в окне --------------------------------
 *
 * Он отвечает на тот же вопрос — «откуда взять профиль», — только другим
 * способом: не заполнять заново, а вернуть сохранённый. Оставить его на
 * странице значило бы спрятать за окном единственный выход для того, кто
 * уже всё это однажды заполнял.
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
  /** Сообщение о нечитаемом профиле, если он был. Место ему — в окне. */
  notice?: ReactNode;
}

/** Профиль, каким он будет, если человек не тронет ни одного поля. */
function blankProfile(): StoredProfile {
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
  });
}

export function RegisterForm({ onCreated, notice }: RegisterFormProps) {
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
      <main className="mx-auto w-full max-w-4xl px-6 pb-16 xl:max-w-6xl 2xl:max-w-7xl">
        <LandingHero
          cta={
            // Та же кнопка, что на посадочной: там она ссылка в расчёт,
            // здесь — открывает окно. Форма и вес совпадают намеренно,
            // человек нажимает то же самое место.
            <Button
              type="button"
              size="lg"
              className="rounded-xl text-base font-bold"
              onClick={() => setOpen(true)}
            >
              Заполнить профиль
            </Button>
          }
        />
      </main>

      <Modal open={open} onClose={() => setOpen(false)} title="Создать профиль">
        <div className="space-y-5">
          {notice}

          {error ? (
            <p className="rounded-xl bg-signal-soft px-4 py-3 text-sm">{error}</p>
          ) : null}

          <SettingsPanel profile={draft} onChange={setDraft} purpose="create" />

          <div className="space-y-5 border-t border-rule pt-4">
            <Button type="button" className="w-full" onClick={submit}>
              Построить мой график
            </Button>

            <ImportBlock onImported={onCreated} />
          </div>
        </div>
      </Modal>

      {/* Подвал той же формы, что на посадочной: линейка через всю
          ширину и переключатель темы у края. Без неё переключатель повисал
          пятном посреди пустого поля под первым экраном. */}
      <footer className="mt-8 border-t border-rule">
        <div className="mx-auto flex w-full max-w-4xl justify-center px-6 py-8 sm:justify-end xl:max-w-6xl 2xl:max-w-7xl">
          <ThemeToggle />
        </div>
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
