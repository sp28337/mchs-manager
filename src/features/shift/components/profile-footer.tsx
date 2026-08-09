"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

import { exportProfile, type StoredProfile } from "../storage/profile";

/**
 * Где лежат данные и как их не потерять.
 *
 * --- Почему об этом сказано прямо на экране -----------------------------
 *
 * Профиль хранится в браузере, и это решение с двумя последствиями,
 * которые человек обязан знать ОБА. Первое хорошее: ни больничные, ни
 * инвалидность никуда не отправляются, истребовать их не у кого. Второе
 * неудобное: очистка данных браузера стирает всё, и другое устройство
 * профиля не увидит.
 *
 * Назвать только первое было бы рекламой. Человек, потерявший год
 * внесённых отпусков после чистки кэша, справедливо решит, что его
 * обманули, — поэтому выгрузка стоит рядом с обещанием, а не в настройках.
 */

export interface ProfileFooterProps {
  profile: StoredProfile;
  onForget: () => void;
}

export function ProfileFooter({ profile, onForget }: ProfileFooterProps) {
  const [confirming, setConfirming] = useState(false);

  function download() {
    const blob = new Blob([exportProfile(profile)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `табель-${profile.accountingYear}-караул-${profile.guardNumber}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <footer className="space-y-4 border-t border-rule pt-6 text-sm">
      <div className="max-w-prose space-y-2">
        <h2 className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
          Где лежат ваши данные
        </h2>
        <p>
          <strong>Только в этом браузере.</strong> Сервера у приложения нет:
          график, отпуска, больничные и правки календаря никуда не
          отправляются. Расчёт считается непосредственно на вашем устройстве. Страница
          работает без интернета.
        </p>
        <p className="text-ink-muted">
          Обратная сторона: если вы очистите данные браузера, профиль исчезнет,
          и на другом устройстве его не будет. Сохраните файл — из него всё
          восстанавливается.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={download}>
          Сохранить профиль в файл
        </Button>

        {confirming ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-ink-muted">
              Удалить профиль с этого устройства? Отменить будет нельзя.
            </span>
            <Button type="button" size="sm" onClick={onForget}>
              Да, удалить
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              Отмена
            </Button>
          </span>
        ) : (
          <button
            type="button"
            className="text-xs text-ink-muted underline underline-offset-2 hover:text-signal"
            onClick={() => setConfirming(true)}
          >
            Удалить профиль с этого устройства
          </button>
        )}
      </div>

      <p className="max-w-prose text-xs text-ink-muted">
        Последнее изменение:{" "}
        {new Date(profile.savedAt).toLocaleString("ru-RU", {
          dateStyle: "long",
          timeStyle: "short",
        })}
        .
      </p>
    </footer>
  );
}
