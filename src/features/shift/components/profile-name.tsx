"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils/cn";

import type { StoredProfile } from "../storage/profile";

/** Дальше имя не растёт — то же ограничение, что было у поля в настройках. */
const MAX_NAME_LENGTH = 200;

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
 * --- Почему правится «текстом», а не полем ввода ----------------------------
 *
 * Пробовали `<input>`. У формы это ЧУЖОЙ элемент: браузер рисует
 * содержимое полей своим путём, отдельным от обычного текста, — и на
 * рукописной гарнитуре с её росчерками этот путь ведёт к другому
 * начертанию, заметно мельче настоящего, хотя запрошенный размер шрифта
 * тот же самый (замерено — совпадает). Слово по факту начинает выглядеть
 * иначе ровно в момент нажатия, а должно оставаться тем же самым словом,
 * просто ставшим печатным.
 *
 * `contenteditable` — не поле, а обычный текст, разрешивший себя
 * редактировать: тот же обычный путь отрисовки, что и у кнопки рядом,
 * буква в букву.
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
  const field = useRef<HTMLSpanElement>(null);

  function edit() {
    setEditing(true);
    // Текст и фокус — уже ПОСЛЕ отрисовки поля: пока стоит кнопка, ставить
    // курсор некуда. `contenteditable`, в отличие от `<input>`, не читает
    // содержимое из атрибута — оно ставится здесь, один раз на вход в
    // правку, и дальше это уже НЕ управляемый React элемент: перерисовка
    // строки при каждой набранной букве сбивала бы курсор на середину.
    requestAnimationFrame(() => {
      const el = field.current;
      if (!el) return;
      el.textContent = profile.displayName;
      el.focus();
      // Курсор — в конец набранного, а не выделением всего имени: имя и
      // так уже целиком читается (правка только поднимает его
      // непрозрачность), а выделение заливкой поверх рукописных букв
      // выглядело бы другим словом, а не тем же самым, ставшим печатным.
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  }

  function commit(event: FormEvent<HTMLSpanElement>) {
    const el = event.currentTarget;
    let text = el.textContent ?? "";
    if (text.length > MAX_NAME_LENGTH) {
      text = text.slice(0, MAX_NAME_LENGTH);
      el.textContent = text;
    }
    onChange((previous) => ({ ...previous, displayName: text }));
  }

  // Enter и Esc уводят фокус из поля тем же путём, что и щелчок мимо:
  // отдельного отката нет, как и у всех остальных полей приложения, —
  // набранное уже записано в профиль по ходу правки.
  function endOnKey(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  return (
    <h1 className="text-3xl font-hand sm:text-5xl leading-tight text-center">
      {editing ? (
        <span
          ref={field}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="false"
          aria-label="Имя профиля"
          onInput={commit}
          onBlur={() => setEditing(false)}
          onKeyDown={endOnKey}
          className={cn(
            "inline-block min-w-[1ch] outline-none",
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
