"use client";

import { useRef, useState } from "react";

import { cn } from "@/lib/utils/cn";

import type { StoredProfile } from "../storage/profile";

/**
 * Имя профиля — водяным знаком над цифрами, правится прямо в нём.
 *
 * --- Почему не поле в настройках -------------------------------------------
 *
 * Имя — единственное, что человек читает на этом экране первым, ещё до
 * цифр: он и так смотрит на него. Отдельное поле в настройках спрашивало о
 * том же самом словом, но в другом месте экрана, и правка начиналась с
 * поиска этого места. Здесь она начинается нажатием по тому, что уже видно.
 *
 * --- Почему ярче только во время правки -------------------------------------
 *
 * Водяной знак нарочно бледный: это подпись, а не заголовок экрана, и
 * спорить с цифрами под ним ему не за что. На время правки он обязан стать
 * читаемым — иначе не видно ни набранного текста, ни курсора, — а как
 * только правка кончилась, возвращается прежним.
 */
export function ProfileName({
  profile,
  onChange,
}: {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
}) {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function edit() {
    setEditing(true);
    // Фокус — уже ПОСЛЕ отрисовки поля: пока стоит кнопка с текстом,
    // фокусировать нечего.
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  }

  return (
    <h1 className="text-3xl font-hand sm:text-5xl leading-tight text-center">
      {editing ? (
        <input
          ref={input}
          value={profile.displayName}
          maxLength={200}
          placeholder="Имя профиля"
          aria-label="Имя профиля"
          onChange={(event) => {
            const displayName = event.target.value;
            onChange((previous) => ({ ...previous, displayName }));
          }}
          onBlur={() => setEditing(false)}
          // Enter и Esc уводят фокус из поля тем же путём, что и щелчок
          // мимо: отдельного отката нет, как и у всех остальных полей
          // приложения, — набранное уже записано в профиль по ходу правки.
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              event.currentTarget.blur();
            }
          }}
          className={cn(
            "w-full bg-transparent text-center outline-none",
            // Указатель — сигнальным цветом и заметно шире обычного:
            // рукописная гарнитура тонкая, и волосяной курсор терялся бы в
            // её штрихах ровно там, где он нужнее всего.
            "caret-signal",
            "rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-trace",
          )}
        />
      ) : (
        <button
          type="button"
          onClick={edit}
          aria-label="Изменить имя профиля"
          className={cn(
            "rounded-sm opacity-10 transition-opacity",
            "hover:opacity-20",
            "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-trace",
          )}
        >
          {profile.displayName || "Имя профиля"}
        </button>
      )}
    </h1>
  );
}
