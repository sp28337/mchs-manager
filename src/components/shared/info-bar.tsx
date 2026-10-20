"use client";

import { useEffect, useState } from "react";

/**
 * Строка подсказок внизу окна — как строка состояния в «Героях 3».
 *
 * --- Что это ----------------------------------------------------------------
 *
 * Наводишь на день — внизу, тихо и серым, написано, что это за сутки; наводишь
 * на число в полосе итога, на знак у кромки, на кнопку в шапке — написано, что
 * это и что будет, если нажать. Там, где подпись нужна, но места на ней нет:
 * клетка в сорок точек не вместит «начало смены, 16 ч, из них ночных 2», а
 * значок без слов не скажет, что он значит.
 *
 * --- Откуда берётся текст ---------------------------------------------------
 *
 * Из атрибута `data-hint` ближайшего предка, а где его нет — из `title`. Второе
 * не случайно: у приложения подсказки уже были, как всплывающие подсказки
 * браузера (`title` на клетках дня, на итоге месяца, на кнопке меню), — и
 * незачем переписывать их ради новой строки. Любой элемент, которому нужна
 * подсказка здесь, получает её атрибутом, и больше ничего подключать не надо.
 *
 * Третий источник — имя кнопки для программы чтения (`aria-label`), если оно
 * говорит больше, чем написано на самой кнопке: так подсказки получили знаки у
 * кромки, кнопка периода, имя графика — всё, что подписано для незрячих, и
 * подписывать это второй раз для зрячих не пришлось.
 *
 * --- Почему всплывающей подсказки браузера при этом нет ------------------
 *
 * Пока строка видна, `title` с элемента под курсором снимается и возвращается,
 * когда курсор ушёл: иначе та же фраза через секунду всплывала бы ещё и у
 * курсора, и человек читал бы её дважды в двух местах. Там, где строки нет
 * (телефон, узкое окно), `title` остаётся на месте и работает как раньше.
 *
 * --- Где её нет -------------------------------------------------------------
 *
 * Только там, где есть и курсор, и место: `(hover: hover)` и от 64 рем. На
 * телефоне наводить нечем, а на узком окне низ занят полосой знаков, и строка
 * встала бы поверх них. Условие то же в таблице стилей (`.info-bar`, она прячет
 * строку) и здесь (скрипт не трогает `title`, когда строка не показана).
 *
 * --- Цвет -------------------------------------------------------------------
 *
 * Тот серый, которым раньше был набран подвал: `text-ink-muted`, отчётливее
 * бледного серого бургера (`MARK_EMPTY_TEXT`). Строка не требует взгляда, но
 * стоит на привычном месте, и подсказку, которую ищут, надо прочесть сразу.
 * Сам бледный серый ушёл в подвал (`site-footer.tsx`): они поменялись.
 *
 * Для программы чтения строки нет вовсе (`aria-hidden`): у элементов есть свои
 * имена и подписи, и повторять их голосом ей незачем.
 */

const WIDE = "(hover: hover) and (min-width: 64rem)";

/** Элемент, чья подсказка сейчас в строке, и снятый с него `title`. */
interface Held {
  element: Element;
  title: string | null;
}

/**
 * Кнопка со своим именем для программы чтения — подсказка и для глаза, но только
 * если имя говорит больше, чем написано на самой кнопке. У знака у кромки на
 * виду одна подпись («Крупнее»), а в имени — что он делает («Крупнее: меньше
 * месяцев в ряду»); у кнопки, на которой написано то же, что в имени, подсказка
 * лишь повторила бы её.
 */
function nameHint(element: Element): boolean {
  const name = element.getAttribute("aria-label")?.trim() ?? "";
  if (name === "") return false;
  return name.toLowerCase() !== (element.textContent ?? "").trim().toLowerCase();
}

/** Ближайший предок, у которого есть что показать в строке. */
function hintElement(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  const marked = target.closest("[data-hint], [title]");
  const named = target.closest("button[aria-label], a[aria-label], [role='switch'][aria-label]");
  // Если подписаны оба, берётся тот, что глубже: подпись кнопки внутри
  // подписанной области важнее подписи области.
  if (named !== null && nameHint(named) && (marked === null || marked.contains(named))) {
    return named;
  }
  return marked;
}

export function InfoBar() {
  const [text, setText] = useState("");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(WIDE);
    let held: Held | null = null;

    // Вернуть элементу его `title`. Если за это время страница сама поставила
    // новый (подпись клетки меняется, когда её правят), старый не трогаем.
    function letGo() {
      if (held === null) return;
      const { element, title } = held;
      held = null;
      if (title !== null && !element.hasAttribute("title")) {
        element.setAttribute("title", title);
      }
    }

    function clear() {
      letGo();
      setShown(false);
    }

    function take(element: Element) {
      if (held?.element === element) return;
      letGo();
      const title = element.getAttribute("title");
      const hint =
        element.getAttribute("data-hint") ?? title ?? element.getAttribute("aria-label");
      if (hint === null || hint.trim() === "") {
        setShown(false);
        return;
      }
      // Родная подсказка браузера гасится, пока та же фраза стоит внизу.
      if (title !== null) element.removeAttribute("title");
      held = { element, title };
      setText(hint);
      setShown(true);
    }

    function onOver(event: PointerEvent) {
      if (!media.matches || event.pointerType === "touch") return;
      const element = hintElement(event.target);
      if (element === null) clear();
      else take(element);
    }

    function onFocus(event: FocusEvent) {
      if (!media.matches) return;
      const element = hintElement(event.target);
      if (element === null) clear();
      else take(element);
    }

    // Нажатие меняет страницу под курсором — и подсказка о том, что было,
    // устаревает; следующее движение мыши поставит новую.
    const onGone = () => clear();

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", onGone, true);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onGone);
    // Прокрутка уводит из-под курсора то, на что он указывал, а события
    // движения при этом нет. Третьим доводом `true`: прокручивается не окно, а
    // страница внутри него, и всплытия у события прокрутки нет.
    window.addEventListener("scroll", onGone, true);
    document.documentElement.addEventListener("pointerleave", onGone);
    media.addEventListener("change", onGone);

    return () => {
      letGo();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", onGone, true);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onGone);
      window.removeEventListener("scroll", onGone, true);
      document.documentElement.removeEventListener("pointerleave", onGone);
      media.removeEventListener("change", onGone);
    };
  }, []);

  return (
    <div aria-hidden className="info-bar" data-shown={shown}>
      <span className="info-bar__text text-ink-muted">{text}</span>
    </div>
  );
}
