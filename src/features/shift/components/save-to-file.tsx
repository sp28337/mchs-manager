"use client";

import { FileBraces, FileDown } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";

import { DialogActions, DialogButton } from "@/components/ui/dialog-parts";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils/cn";

import { schedulePatternOf } from "../domain/schedule-pattern";
import { changeCountOf } from "../model/derive";
import { profileFileText } from "../storage/library";
import { markProfileExported, type StoredProfile } from "../storage/profile";
import { eventsRu } from "./changes-timeline";

/**
 * Выгрузка профиля в файл.
 *
 * Хранилище браузера — единственное место, где живут данные, и очистка
 * кэша стирает год внесённых отпусков. Такое действие нельзя держать
 * только в подвале, докуда нужно долистать двенадцать календарных сеток;
 * его место в шапке, рядом с настройками и расчётом.
 *
 * --- Почему имя файла спрашивается ----------------------------------------
 *
 * Оно подставлялось само — по имени профиля — и уходило в «Загрузки» без
 * единого вопроса. Пока профиль один, это удобно; но файлы копят: «Мой
 * график.json», «Мой график (1).json», «Мой график (2).json» — и через
 * полгода не сказать, какой из них до отпуска, а какой после. Дописать
 * «до отпуска» человек хочет ровно в тот момент, когда сохраняет, а не
 * потом в проводнике.
 *
 * Спрашивается окном, а не системным «Сохранить как»: родной выбор пути
 * (`showSaveFilePicker`) есть только в настольном Chromium, а на iPhone,
 * с которого график и правят чаще всего, его нет вовсе. Одно окно на все
 * устройства честнее, чем разное поведение на разных.
 *
 * Имя профиля остаётся умолчанием: в девяти случаях из десяти его и
 * подтверждают, и лишнего движения это не стоит.
 *
 * --- Почему это крючок, а не кнопка ---------------------------------------
 *
 * Кнопок у выгрузки две — в шапке значком и в подвале профиля, где о ней
 * сказано словами, — и выглядят они по-разному. Общим у них должно быть
 * не оформление, а само действие вместе с окном: разойдись они, и файл из
 * шапки однажды поедет с другим именем, чем из подвала.
 *
 * Третье место — предупреждение «сначала сохранить нынешний?» в настройках.
 * Оно обязано вести себя ТОЧНО так же, как кнопка в шапке: то же окно, то
 * же имя файла по умолчанию, тот же знак на кнопке. Своя, укороченная
 * выгрузка там уже была — она уносила файл в загрузки молча, не спросив
 * имени, — и это была вторая выгрузка с другим поведением, ровно то, ради
 * чего этот крючок и заведён.
 */
export function useSaveToFile(
  profile: StoredProfile,
  options?: {
    /**
     * Окно откроется ПОВЕРХ другого окна.
     *
     * От этого зависит одно: страница под ним гасится плотнее. Родного
     * затемнения у таких окон нет — оно утащило бы в темноту лампу.
     * Подробности — в `ui/confirm-dialog.tsx`, там же первое такое окно.
     */
    over?: boolean;
    /**
     * Файл ушёл человеку.
     *
     * Нужно кнопке «Открыть»: она спрашивает «сначала сохранить нынешний?»,
     * и на «да» обязана довести дело до конца — сохранить И открыть выбор
     * файла. Без этого человек, ответивший «сначала сохранить», получал бы
     * сохранение и тишину, а нажимать «Открыть» ему пришлось бы второй раз.
     *
     * Зовётся ВНУТРИ нажатия на «Сохранить», а не из эффекта: за выбором
     * файла браузер пускает только по живому действию человека, и
     * отложенный вызов он бы отклонил.
     */
    onSaved?: () => void;
  },
): {
  /** Открыть окно с именем файла. */
  ask: () => void;
  /** Само окно. Ставится в конце разметки вызывающего. */
  dialog: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  return {
    // Имя подставляется заново при каждом открытии: человек, набравший
    // что-то и передумавший, во второй раз должен увидеть имя профиля, а
    // не остатки прошлой попытки.
    ask: () => {
      setName(fileNameOf(profile.displayName));
      setOpen(true);
    },
    dialog: (
      <SaveDialog
        profile={profile}
        open={open}
        name={name}
        onName={setName}
        onClose={() => setOpen(false)}
        over={options?.over}
        onSaved={options?.onSaved}
      />
    ),
  };
}

function SaveDialog({
  profile,
  open,
  name,
  onName,
  onClose,
  over,
  onSaved,
}: {
  profile: StoredProfile;
  open: boolean;
  name: string;
  onName: (name: string) => void;
  onClose: () => void;
  over?: boolean;
  onSaved?: () => void;
}) {
  const nameId = useId();
  const suggested = fileNameOf(profile.displayName);
  const chosen = chosenFileName(profile, name);

  // Размер — того файла, что действительно уйдёт: тот же текст, что у
  // выгрузки. Считается, только пока окно открыто, и заново лишь когда
  // меняется профиль: имя файла на размер не влияет, а набор текста не
  // должен каждый раз собирать весь файл.
  const bytes = useMemo(
    () => (open ? new Blob([profileFileText(profile)]).size : 0),
    [open, profile],
  );
  const events = changeCountOf(profile);

  function submit() {
    downloadProfile(profile, name);
    onClose();
    // Продолжение — здесь же, в нажатии: тому, кто позвал выгрузку ради
    // следующего шага, этот шаг нужно сделать, пока действие человека ещё
    // «живое». Подробности у самого довода.
    onSaved?.();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Сохранить график в файл"
      // Зелёным: человек получает то, ради чего пришёл, — файл со своим
      // графиком. Ничего не стирается и ничем не рискуют.
      icon={<FileDown />}
      tone="verify"
      lead="Файл можно открыть на любом устройстве — кнопкой «Из файла» в «Графиках»."
      className={cn("w-[min(30rem,calc(100vw-2rem))]", over && "modal-over-modal")}
      footer={
        <DialogActions>
          <DialogButton onClick={onClose}>Отмена</DialogButton>
          {/* Фокус — на «Сохранить», а не на поле: в девяти случаях из десяти
              имя подтверждают как есть, и на телефоне клавиатура, выскочившая
              при открытии, закрывала бы половину окна. Править имя — нажать
              на поле; Enter в поле по-прежнему сохраняет. */}
          <DialogButton variant="primary" data-autofocus="" onClick={submit}>
            Сохранить
          </DialogButton>
        </DialogActions>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={nameId}>Имя файла</Label>
          {/* Поле и расширение — одной коробкой: `.json` приписывается всегда
              (`downloadProfile`), и набрать его самому не нужно, а набранное
              снимается. Коробка, а не `Input`: у того своя рамка, а здесь она
              одна на поле и суффикс. */}
          <div
            className={cn(
              "flex h-10 items-center rounded-lg border border-paper bg-paper transition-colors",
              "hover:border-ink-muted focus-within:border-ink",
            )}
          >
            <input
              id={nameId}
              value={name}
              maxLength={100}
              placeholder={suggested}
              onChange={(event) => onName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
              className="h-full min-w-0 flex-1 bg-transparent pl-3 text-sm text-ink outline-none placeholder:text-ink-faint"
            />
            <span aria-hidden className="pr-3 font-mono text-sm text-ink-faint select-none">
              .json
            </span>
          </div>
        </div>

        {/* Что получится: итоговое имя (с учётом чистки и пустого поля),
            состав и размер. Человек видит, что именно положат в «Загрузки», до
            нажатия, а не по строке внизу окна браузера после. Лунка, а не
            плашка: окно уже поднятая бумага, и второй такой внутри не нужно. */}
        <div className="flex items-center gap-3 rounded-lg bg-paper px-3 py-2.5">
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-lg border border-rule bg-paper-raised text-ink-muted [&_svg]:size-4"
          >
            <FileBraces />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{chosen}.json</span>
            <span className="block truncate text-xs text-ink-muted tabular-nums">
              График {schedulePatternOf(profile.schedulePattern).label} · {profile.accountingYear} г.
              · {events === 0 ? "без событий" : eventsRu(events)} · {fileSizeRu(bytes)}
            </span>
          </span>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Собственно выгрузка.
 *
 * В файл уходит не только открытый профиль, но и папки проводника со
 * вложенными в них профилями (`profileFileText`). Отдельной кнопки у этого
 * нет нарочно: «сохранить профиль» и значит «сохранить то, что у меня
 * есть», а файл, из которого половина списка не восстанавливается, —
 * половина спасения. Почему это не ломает старые файлы и почему приходят
 * копии, разобрано в `storage/library.ts`.
 *
 * Имя чистится тем же правилом, что и подставленное: человек мог набрать
 * что угодно, включая косую черту, — а имя файла терпит не всё. Пустое
 * поле — не отказ: сохраняется под именем профиля, потому что человек
 * пришёл сохранять, а не спорить о названии.
 */
export function downloadProfile(profile: StoredProfile, name: string): void {
  // Отметка о выгрузке ставится здесь, а не в диалоге: файл отдан человеку
  // именно тут, и любой другой способ его получить прошёл бы мимо отметки.
  markProfileExported(profile.savedAt);
  const chosen = chosenFileName(profile, name);
  const blob = new Blob([profileFileText(profile)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${chosen}.json`;
  // Ссылка вставляется в страницу перед нажатием: Chromium срабатывает и
  // на оторванной от документа, а Firefox исторически требует, чтобы она
  // была в дереве.
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Имя файла без расширения: то, что уйдёт в «Загрузки», и то, что окно
 * показывает заранее, — из одного места, чтобы показанное не разошлось с
 * отданным.
 *
 * Расширение снимается, если человек его набрал: иначе получилось бы
 * «график.json.json». Пустое поле — имя профиля.
 */
export function chosenFileName(profile: StoredProfile, typedName: string): string {
  const typed = typedName.replace(/\.json$/i, "").trim();
  return fileNameOf(typed === "" ? profile.displayName : typed);
}

/** Размер файла по-русски: «812 Б», «3,2 КБ», «1,4 МБ». */
export function fileSizeRu(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1).replace(".", ",")} КБ`;
  return `${(kb / 1024).toFixed(1).replace(".", ",")} МБ`;
}

/**
 * Имя файла — это имя профиля.
 *
 * Оно и есть то, чем человек свои графики различает: в папке «Загрузки»
 * рядом лежат «Основной график» и «Подработка», а не два «графика» с
 * годами, из которых непонятно, где чей. Год в имени тем более не нужен —
 * в файле лежит весь профиль целиком, а не срез одного года.
 *
 * Опасные для файловой системы знаки заменяются, а не выбрасываются:
 * пропажа знака молча склеивает слова, а дефис на его месте сохраняет
 * границу. Обрезка на сотне знаков — от предела длины имени в файловых
 * системах (255 байт, а кириллица весит по два).
 */
export function fileNameOf(displayName: string): string {
  const safe = displayName
    // Управляющие символы: имя приходит из свободного поля, и вставить
    // туда можно что угодно, включая перевод строки. На их место встаёт
    // пробел, а не пустота: перевод строки разделял слова, и выброси его
    // молча — слова склеятся.
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    // Разделители путей и знаки, запрещённые в именах файлов Windows.
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    // Точки и дефисы по краям: имя, начинающееся с точки, в macOS и Linux
    // становится скрытым файлом.
    .replace(/^[.\s-]+|[.\s-]+$/g, "");

  return safe === "" ? "график" : safe;
}
