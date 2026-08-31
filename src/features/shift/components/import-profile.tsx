"use client";

import { useId, useState, type ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";

import { importProfile, type StoredProfile } from "../storage/profile";

/**
 * Возврат из файла.
 *
 * Профиль живёт в браузере, а браузеры чистят. Без этой кнопки
 * единственным способом вернуть свой год после очистки был бы ввод заново
 * — включая все больничные, которые человек уже вспоминал однажды.
 *
 * --- Почему деталь общая на два места -------------------------------------
 *
 * Мест теперь два: окно «Создать профиль» и закладка профиля в настройках.
 * Дело у них одно — открыть файл, — а обстановка разная: в первом открывать
 * поверх нечего, во втором на устройстве лежит год работы, и перед заменой
 * о нём нужно спросить.
 *
 * Спрашивает при этом НЕ эта деталь. Она умеет одно: выбрать файл и отдать
 * прочитанный профиль наружу. Кто и о чём предупреждает до того — забота
 * того места, где деталь стоит; иначе окно создания задавало бы вопрос,
 * на который у него нет повода.
 *
 * Заголовок и пояснение тоже приходят снаружи: «Уже заполняли раньше»
 * уместно в анкете и бессмысленно в настройках, где профиль открыт.
 */
export function ImportProfileBlock({
  title,
  children,
  onImported,
  onPick,
}: {
  title: string;
  /** Пояснение под заголовком: у каждого места своё. */
  children: ReactNode;
  onImported: (profile: StoredProfile) => void;
  /**
   * Спросить перед выбором файла — и разрешить или не разрешить.
   *
   * Возвращает `true`, если открывать можно. Настройки отвечают на это
   * вопросом о несохранённом профиле, окно создания не отвечает вовсе:
   * там поверх нечего открывать.
   */
  onPick?: () => boolean;
}) {
  const headingId = useId();
  const fileId = useId();
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3
        id={headingId}
        className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted"
      >
        {title}
      </h3>
      <p className="text-sm text-ink-muted">{children}</p>
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
          // Вопрос задаётся ДО того, как браузер откроет выбор файла:
          // спрашивать после — значит спрашивать у человека, который уже
          // нашёл файл и нажал «Открыть».
          onClick={(event) => {
            if (onPick && !onPick()) event.preventDefault();
          }}
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
