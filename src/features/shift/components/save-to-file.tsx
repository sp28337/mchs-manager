"use client";

import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";

import { exportProfile, type StoredProfile } from "../storage/profile";

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
 */
export function useSaveToFile(profile: StoredProfile): {
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
}: {
  profile: StoredProfile;
  open: boolean;
  name: string;
  onName: (name: string) => void;
  onClose: () => void;
}) {
  const nameId = useId();
  const suggested = fileNameOf(profile.displayName);

  function submit() {
    downloadProfile(profile, name);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Сохранить профиль в файл">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={nameId}>Имя файла</Label>
          <Input
            id={nameId}
            value={name}
            maxLength={100}
            placeholder={suggested}
            onChange={(event) => onName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
          <p className="text-xs text-ink-muted">
            Расширение «.json» допишется само. Запрещённые в именах файлов
            знаки заменятся на дефис.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
          <Button type="button" onClick={submit}>
            Сохранить
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Собственно выгрузка.
 *
 * Имя чистится тем же правилом, что и подставленное: человек мог набрать
 * что угодно, включая косую черту, — а имя файла терпит не всё. Пустое
 * поле — не отказ: сохраняется под именем профиля, потому что человек
 * пришёл сохранять, а не спорить о названии.
 */
export function downloadProfile(profile: StoredProfile, name: string): void {
  // Расширение снимается, если человек его набрал: иначе получилось бы
  // «график.json.json».
  const typed = name.replace(/\.json$/i, "").trim();
  const chosen = fileNameOf(typed === "" ? profile.displayName : typed);
  const blob = new Blob([exportProfile(profile)], { type: "application/json" });
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
