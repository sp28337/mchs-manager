"use client";

import { ChevronLeft, ChevronRight, GripVertical, Pencil, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils/cn";

import {
  activeEntryId,
  createFolder,
  deleteEntry,
  deleteFolder,
  folderPath,
  freeName,
  importEntry,
  loadLibrary,
  moveEntry,
  nameTaken,
  renameEntry,
  renameFolder,
  ROOT_FOLDER_ID,
  subscribeToLibrary,
  type Library,
  type LibraryEntry,
  type LibraryFolder,
} from "../storage/library";
import { importProfile, type StoredProfile } from "../storage/profile";
import { CreateProfileModal } from "./create-profile-modal";
import { useEntryDrag } from "./use-entry-drag";

/**
 * Проводник по сохранённым профилям.
 *
 * --- Почему это страница, а не окно ---------------------------------------
 *
 * Раньше «Открыть» вело прямо в системный выбор файла, спросив перед этим
 * «сначала сохранить нынешний?». Файл — не единственное место, где у
 * человека лежат графики: в браузере их может быть несколько, и выбирать
 * между ними в окне поверх страницы значило бы показывать список графиков
 * поверх одного из них.
 *
 * Поэтому проводник встаёт НА МЕСТО календаря — там же, где на телефоне
 * встают настройки (`workspace.tsx`). Страница не сменилась, сменилось то,
 * что на ней показано; знак в шапке при этом читает «Профили», а кнопка,
 * которой открыли, становится кнопкой закрытия.
 *
 * --- Порядок вопросов ------------------------------------------------------
 *
 * Вопрос «сохранить несохранённое?» переехал ЗА выбор: сперва человек
 * находит профиль, который хочет открыть, и только потом отвечает про
 * нынешний. Прежний порядок спрашивал о потере до того, как человек узнал,
 * ради чего она, — и отвечать на такой вопрос нечем.
 *
 * --- Один уровень папок ----------------------------------------------------
 *
 * Папки лежат в grafik13 и внутрь друг друга не вкладываются. Дерево здесь
 * нечему описывать: графиков у человека единицы, а путь из трёх колен на
 * телефоне не показать, не отняв у списка всю ширину.
 *
 * --- Почему кнопки действий стоят в шапке ----------------------------------
 *
 * «Папка», «Профиль», «Из файла» встают НА МЕСТО кнопок рабочего экрана —
 * тех самых «Настройки», «Открыть», «Сохранить», из которых сюда и пришли
 * (`header-tools.tsx`). Это те же три места в той же строке: пока открыт
 * проводник, действия у страницы другие, а мест для них ровно столько же.
 *
 * Своя полоса кнопок внутри проводника была бы четвёртой строкой сверху —
 * после шапки, имени и цифр, — и отодвигала бы сам список ещё ниже на
 * экране, где его и так немного.
 */

/**
 * Состояние трёх действий проводника, вынесенных в шапку.
 *
 * Живёт отдельным крючком, потому что нажимают на них в ОДНОМ месте
 * (шапка), а происходит от них другое — в ДРУГОМ (проводник): поле имени
 * новой папки встаёт в сетку папок, окно создания открывается поверх
 * списка, выбор файла прячется в нём же. Держать это состояние в шапке
 * значило бы поселить там половину проводника, а в проводнике — узнавать о
 * нажатиях кнопок, которых он не рисует.
 */
export interface ExplorerTools {
  /** Три действия — для кнопок шапки. */
  newFolder: () => void;
  newProfile: () => void;
  importFile: () => void;
  /** Что из этого сейчас происходит — для самого проводника. */
  addingFolder: boolean;
  closeFolderField: () => void;
  creating: boolean;
  closeCreate: () => void;
  /** Открытая папка: в неё же ложится и загруженный файл. */
  folderId: string;
  openFolder: (id: string) => void;
  error: string | null;
}

export function useExplorerTools(): ExplorerTools {
  const [addingFolder, setAddingFolder] = useState(false);
  const [creating, setCreating] = useState(false);
  const [folderId, setFolderId] = useState(ROOT_FOLDER_ID);
  const [error, setError] = useState<string | null>(null);

  return {
    newFolder: () => {
      setError(null);
      setAddingFolder(true);
    },
    newProfile: () => {
      setError(null);
      setCreating(true);
    },
    importFile: () => {
      setError(null);
      // Файл ложится в проводник ЗАПИСЬЮ, а не открывается сразу: человек
      // пришёл сюда за списком графиков, и подменять ему открытый профиль,
      // пока он только пополняет список, нельзя.
      pickProfileFile((profile) => {
        // Имена профилей не повторяются, но отказать здесь нельзя: файл
        // уже выбран, и «такое имя занято» не пустило бы в приложение его
        // же сохранённый год. Поэтому имя подбирается свободное — и о
        // подмене говорится вслух, иначе человек искал бы в списке то, под
        // которым сохранял.
        const displayName = freeName(profile.displayName);
        importEntry({ ...profile, displayName }, folderId);
        if (displayName !== profile.displayName.trim()) {
          setError(
            `Профиль «${profile.displayName.trim()}» уже есть, поэтому ` +
              `загруженный назван «${displayName}».`,
          );
        }
      }, setError);
    },
    addingFolder,
    closeFolderField: () => setAddingFolder(false),
    creating,
    closeCreate: () => setCreating(false),
    folderId,
    openFolder: setFolderId,
    error,
  };
}

/**
 * Выбор файла — полем, созданным на месте и тут же выброшенным.
 *
 * Поле, лежащее в разметке невидимкой, потребовало бы ссылки на себя
 * (`ref`), а ссылка эта нужна была бы в ШАПКЕ, где стоит кнопка, — то есть
 * в чужом дереве. Здесь поле живёт ровно столько, сколько длится нажатие.
 *
 * В документ оно всё же вставляется: Chromium срабатывает и на оторванном
 * от дерева, а Safari исторически требует, чтобы поле в нём было, — та же
 * оговорка, что и у ссылки для выгрузки (`save-to-file.tsx`).
 */
function pickProfileFile(
  onPicked: (profile: StoredProfile) => void,
  onError: (message: string) => void,
): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.className = "sr-only";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    try {
      onPicked(importProfile(await file.text()));
    } catch (cause) {
      onError(
        cause instanceof Error
          ? `${cause.message} Нужен файл, сохранённый этим же приложением.`
          : "Файл не прочитан.",
      );
    }
  });
  document.body.append(input);
  input.click();
}

export function ProfileExplorer({
  tools,
  previewId,
  onPreview,
  onChange,
  onOpenEntry,
}: {
  /** Три действия из шапки и их состояние (`useExplorerTools`). */
  tools: ExplorerTools;
  /** Запись, которую сейчас показывают наверху страницы, или `null`. */
  previewId: string | null;
  onPreview: (entryId: string | null) => void;
  /** Правка открытого профиля: ею переименовывается открытая запись. */
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  /** Человек выбрал профиль. Спросить про нынешний и открыть — забота вызывающего. */
  onOpenEntry: (entry: LibraryEntry) => void;
}) {
  const { library, activeId } = useLibrary();
  const list = useRef<HTMLUListElement>(null);
  const [renaming, setRenaming] = useState<Rename | null>(null);
  const [removing, setRemoving] = useState<Removal | null>(null);
  /** «Имя занято» — о переименовании; у действий шапки свой сказ. */
  const [taken, setTaken] = useState<string | null>(null);

  /**
   * Наведение показывает профиль наверху страницы, нажатие открывает.
   *
   * На экране без указателя наведения не бывает вовсе, и оба действия
   * достаются одной и той же строке по очереди: первое нажатие
   * показывает, второе — открывает. Порядок тот же, что и с мышью, просто
   * оба шага делаются пальцем.
   */
  const hoverable = useMediaQuery("(hover: hover)");

  // Папка могла исчезнуть, пока её содержимое было открыто, — в соседней
  // вкладке или тем же человеком до входа сюда. Показывать пустоту с
  // заголовком удалённой папки нельзя, поэтому возврат к grafik13.
  const current =
    library.folders.find((folder) => folder.id === tools.folderId) ?? library.folders[0]!;
  const path = folderPath(library, current.id);
  const folders = library.folders.filter((folder) => folder.parentId === current.id);
  const entries = library.entries
    .filter((entry) => entry.folderId === current.id)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));

  const { drag, handlers } = useEntryDrag({ onDrop: moveEntry });

  /**
   * Строки профилей — одной ширины, по самой длинной из них.
   *
   * --- Почему замером, а не правилом вёрстки ---------------------------------
   *
   * Ширина строки берётся из её содержимого — имени, у которого нет ни
   * заданной длины, ни предела: «2025» и «Тараканов Павел Николаевич» стоят
   * в одном списке. Разложенные переносом, такие строки дают рваный правый
   * край; растянутые на колонку в треть экрана — пустую бумагу справа от
   * короткого имени.
   *
   * Ни того ни другого не выражает ни одно правило вёрстки: `max-content` у
   * колонки грида считается по КАЖДОЙ колонке отдельно, а `1fr` о
   * содержимом не знает вовсе. Остаётся замер — им же меряется полоса цифр
   * наверху страницы (`period-summary.tsx`).
   *
   * Меряется натуральная ширина: перед замером назначенная снимается, иначе
   * со второго раза мерилась бы она сама. Ставится она прямо в разметку,
   * минуя перерисовку, — состояние завело бы второй проход отрисовки на
   * каждую правку имени.
   *
   * На телефоне ширины нет вовсе: там строки идут столбиком во всю ширину
   * экрана (`ul` ниже), и равнять их не по чему.
   */
  const wideRows = useMediaQuery("(min-width: 40rem)");
  const rowsKey = `${entries.map((entry) => `${entry.id}:${entry.name}`).join("|")}#${activeId}`;

  useLayoutEffect(() => {
    const ul = list.current;
    if (ul === null) return;
    const items = [...ul.children].filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );
    for (const item of items) item.style.width = "";
    if (!wideRows) return;
    const widest = items.reduce(
      (max, item) => Math.max(max, item.getBoundingClientRect().width),
      0,
    );
    if (widest === 0) return;
    for (const item of items) item.style.width = `${Math.ceil(widest)}px`;
  }, [wideRows, rowsKey, renaming]);

  function commitRename(value: string) {
    if (renaming === null) return;
    const name = value.trim();
    if (name !== "") {
      if (renaming.kind === "folder") renameFolder(renaming.id, name);
      else {
        // Занятое имя — отказ, а не молчаливая замена: переименование
        // сюда и привело, и подставить взамен «Основной (2)» значило бы
        // ответить не на то, о чём просили. Строка остаётся собой, а
        // почему — сказано над списком.
        if (nameTaken(name, renaming.id)) {
          setTaken(
            `Профиль «${name}» уже есть. У двух одинаковых имён в списке ` +
              `не отличить одно от другого.`,
          );
          setRenaming(null);
          return;
        }
        setTaken(null);
        // Имя открытого профиля правится на самой странице, а не в
        // перечне: в перечень оно придёт отражением
        // (`syncActiveIntoLibrary`), и двух разных имён у одного графика
        // не случится.
        if (renaming.id === activeId) {
          onChange((previous) => ({ ...previous, displayName: name }));
        } else renameEntry(renaming.id, name);
      }
    }
    setRenaming(null);
  }

  return (
    // Колонка с просветом, а не `space-y`: список профилей отодвигается
    // от папок ещё на ступень (`mt-6` ниже), и в колонке отступ
    // складывается с просветом, а не спорит с ним.
    <div className="flex flex-col gap-4">
      {/* Путь до открытой папки: с вложенностью «назад» перестало означать
          «в самый верх», и вернуться человек вправе на любую ступень.
          Каждое колено — ещё и место, куда можно перетащить профиль наверх.

          У самого верха имени нет. Служебное «grafik13» — название папки
          в хранилище, а не то, что человек заводил: показывать его значило
          бы называть началом списка чужое слово. От верха остаётся стрелка,
          и она же ловит перетаскиваемый профиль.

          --- Как строка собрана -------------------------------------------

          Строка читается как заголовок раздела: слева квадратная плашка со
          стрелкой — ровно такая же, как плашки в шапке страницы, и такой же
          высоты, — а за ней имя открытой папки тем же начертанием, каким
          названы заголовки везде.

          Плашка квадратная, а не «кнопка с полями»: внутри у неё один
          значок, и поля по бокам делали её то шире, то у́же соседних плашек
          страницы. Имя выровнено по её середине (`leading-none`): у строки
          заголовка собственная высота строки, и без этого слово стояло на
          полточки выше стрелки — той самой неаккуратности, которую видно,
          но не объяснить.

          Ступени между верхом и открытой папкой — плашки помельче, и
          разделяет их галочка, а не косая черта: та же стрелка, что и
          слева, только повёрнутая, — одним знаком меньше в строке. */}
      {path.length > 1 ? (
        <nav
          aria-label="Где мы в проводнике"
          className="flex min-h-8 flex-wrap items-center gap-2"
        >
          {path.map((folder, index) =>
            index === path.length - 1 ? (
              <h2
                key={folder.id}
                className="min-w-0 truncate font-display text-lg leading-none"
              >
                {folder.name}
              </h2>
            ) : (
              <span key={folder.id} className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  data-folder-drop={folder.id}
                  onClick={() => tools.openFolder(folder.id)}
                  data-glow={drag?.over === folder.id ? "on" : undefined}
                  aria-label={
                    folder.id === ROOT_FOLDER_ID ? "Ко всем профилям" : folder.name
                  }
                  className={cn(
                    "lit inline-flex h-8 shrink-0 cursor-pointer items-center justify-center",
                    "rounded-xl bg-paper-raised text-ink-muted transition-colors hover:text-ink",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                    index === 0 ? "w-8" : "min-w-0 max-w-40 truncate px-3 text-sm",
                  )}
                >
                  {index === 0 ? (
                    <ChevronLeft aria-hidden className="size-4.5" />
                  ) : (
                    folder.name
                  )}
                </button>
                {/* Галочка разделяет ИМЕНА: сразу после стрелки «назад» она
                    висела бы сама по себе — там и так видно, где строка
                    начинается. */}
                {index === 0 ? null : (
                  <ChevronRight aria-hidden className="size-3.5 shrink-0 text-ink-faint" />
                )}
              </span>
            ),
          )}
        </nav>
      ) : null}

      {(tools.error ?? taken) !== null ? (
        <p className="rounded-xl bg-signal-soft px-4 py-3 text-sm">{tools.error ?? taken}</p>
      ) : null}

      <FolderShape />

      {/* Две папки в ряд помещаются уже на самом узком телефоне — оттуда и
          считается всё остальное: с шириной экрана они сперва подрастают,
          а дойдя до своего размера (11 рем), дальше не растягиваются —
          прибавляется столбец. Папка предмет известного размера, и треть
          монитора ей ни к чему. */}
      {folders.length > 0 || tools.addingFolder ? (
        <ul
          className={cn(
            "grid gap-3 grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))]",
            "min-[420px]:grid-cols-[repeat(auto-fill,minmax(9rem,11rem))]",
          )}
        >
          {folders
            .map((folder) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                hoverable={hoverable}
                highlighted={drag?.over === folder.id}
                renaming={renaming?.kind === "folder" && renaming.id === folder.id}
                onRename={() => setRenaming({ kind: "folder", id: folder.id, value: folder.name })}
                onCommit={commitRename}
                onCancel={() => setRenaming(null)}
                onOpen={() => tools.openFolder(folder.id)}
                onDelete={() => setRemoving({ kind: "folder", id: folder.id, name: folder.name })}
              />
            ))}
          {tools.addingFolder ? (
            <li className="rounded-xl bg-paper-raised p-2 lit">
              <NameField
                value=""
                placeholder="Имя папки"
                onCommit={(value) => {
                  const name = value.trim();
                  // Новая папка заводится ТАМ, где человек сейчас стоит, —
                  // в открытой, а не в grafik13: иначе «создать папку»
                  // внутри папки означало бы «создать где-то ещё».
                  if (name !== "") createFolder(name, current.id);
                  tools.closeFolderField();
                }}
                onCancel={tools.closeFolderField}
              />
            </li>
          ) : null}
        </ul>
      ) : null}

      {/* Профили — плитками, а не строкой на всю ширину. Строка была
          списком в одну колонку и на мониторе: имя слева, четыре пятых
          ширины пустые. Плитка в тех же условиях встаёт второй и третьей в
          ряд, и весь список видно разом — а выбирают здесь именно
          сравнением. */}
      {/* Профили отодвинуты от папок сильнее, чем папки друг от друга:
          это две разные вещи, а не продолжение одного ряда, и общий
          просвет ставил их так, будто список начинается прямо в сетке
          папок. Папок нет — отодвигать не от чего. */}
      {/* На телефоне — столбик во всю ширину, на экране пошире — строки
          вперемежку, как папки.
          ------------------------------------------------------------------
          Строка профиля коротка: ручка, имя и две кнопки. Растянутая на
          монитор, она занимала содержимым треть ширины, а две трети
          оставались пустой бумагой; поставленная одним узким столбцом —
          оставляла пустой всю правую половину экрана. Перенос по строкам
          (`flex-wrap`) кладёт их столько, сколько помещается в ряду, — тем
          же способом, каким разложены папки выше, — а ширина у всех одна,
          по самой длинной строке (замер выше).

          На телефоне переносить нечего: две строки в ряд там не встанут
          ни при какой длине имени, а растянутая на всю ширину строка —
          самая крупная цель, какую можно дать пальцу. Поэтому ниже `sm`
          это обычный столбик, и каждая строка занимает всю ширину.

          `max-w-full` у строки — на случай длинного имени: содержимое
          шире экрана не растянет её за край, имя упрётся в ширину
          страницы и обрежется многоточием, как и прежде. */}
      <ul
        ref={list}
        className={cn(
          "flex flex-col gap-3 empty:hidden sm:flex-row sm:flex-wrap",
          folders.length > 0 || tools.addingFolder ? "mt-6" : null,
        )}
      >
        {entries.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            active={entry.id === activeId}
            dragging={drag?.moved === true && drag.entryId === entry.id}
            renaming={renaming?.kind === "entry" && renaming.id === entry.id}
            grip={handlers(entry.id, entry.name)}
            previewed={previewId === entry.id}
            // С указателем наведение показывает, нажатие открывает. Без
            // него показывает первое нажатие, а открывает второе — по той
            // же строке.
            onHover={hoverable ? () => onPreview(entry.id) : undefined}
            onLeave={hoverable ? () => onPreview(null) : undefined}
            onOpen={() => {
              if (hoverable || previewId === entry.id) onOpenEntry(entry);
              else onPreview(entry.id);
            }}
            onRename={() => setRenaming({ kind: "entry", id: entry.id, value: entry.name })}
            onCommit={commitRename}
            onCancel={() => setRenaming(null)}
            onDelete={() => setRemoving({ kind: "entry", id: entry.id, name: entry.name })}
          />
        ))}
      </ul>

      {entries.length === 0 && folders.length === 0 ? (
        <p className="rounded-xl bg-paper-raised px-4 py-6 text-center text-sm text-ink-muted lit">
          {current.id === ROOT_FOLDER_ID
            ? "Здесь будут ваши графики. Создайте новый профиль или загрузите сохранённый файл."
            : "Папка пуста. Перетащите сюда профиль за полоску слева от имени."}
        </p>
      ) : null}

      {/* Призрак под пальцем: строка, оторванная от списка, — единственный
          признак того, что перенос идёт. Указателя он не ловит, иначе сам
          оказывался бы «тем, что под пальцем» вместо папки. */}
      {drag?.moved ? (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2",
            "rounded-xl bg-paper-raised px-3 py-2 text-sm shadow-lg ring-1 ring-rule-strong",
          )}
          style={{ left: drag.x, top: drag.y }}
        >
          {drag.name}
        </div>
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing === null) return;
          if (removing.kind === "folder") deleteFolder(removing.id);
          else deleteEntry(removing.id);
        }}
        title={removing?.kind === "folder" ? "Удалить папку?" : "Удалить профиль?"}
        confirm="Удалить"
        destructive
        icon={<Trash2 aria-hidden />}
      >
        {removing?.kind === "folder" ? (
          <p>
            Папка «{removing.name}» исчезнет, а всё, что в ней лежало,
            поднимется на ступень выше. Данные не пропадут.
          </p>
        ) : (
          <p>
            Профиль «{removing?.name}» и все его данные будут удалены. Это
            действие нельзя отменить.
          </p>
        )}
      </ConfirmDialog>

      <CreateProfileModal
        open={tools.creating}
        onClose={tools.closeCreate}
        onCreated={(profile) => {
          // Заведённый профиль ложится ЗАПИСЬЮ в открытую папку — ровно
          // так же, как загруженный из файла, и по той же причине:
          // человек пришёл сюда пополнить список, а не сменить то, над
          // чем работает.
          //
          // Прежде новый профиль немедленно становился открытым, и
          // проводник закрывался: завести второй график, стоя в первом,
          // было нельзя — страница уходила из-под рук. Теперь он просто
          // появляется в папке, где его завели, а откроется тогда же,
          // когда и любой другой: нажатием по нему.
          tools.closeCreate();
          importEntry(profile, current.id);
        }}
      />
    </div>
  );
}

interface Rename {
  kind: "entry" | "folder";
  id: string;
  value: string;
}

interface Removal {
  kind: "entry" | "folder";
  id: string;
  name: string;
}

/**
 * Перечень и указатель на открытую запись — одним снимком.
 *
 * Читаются они вместе и обновляются вместе: указатель без перечня
 * пометил бы открытым профиль, которого в списке уже нет.
 *
 * Вынесен наружу: тем же перечнем пользуется статистика — она считает по
 * нему свод по всем профилям (`statistics.tsx`). Второй такой же подписки
 * заводить нельзя: разойдись они хоть на одну правку, и свод показал бы
 * профиль, которого в проводнике уже нет.
 */
export function useLibrary(): { library: Library; activeId: string | null } {
  const [snapshot, setSnapshot] = useState(() => ({
    library: loadLibrary(),
    activeId: activeEntryId(),
  }));

  useEffect(
    () =>
      subscribeToLibrary(() =>
        setSnapshot({ library: loadLibrary(), activeId: activeEntryId() }),
      ),
    [],
  );

  return snapshot;
}

/**
 * Очертание папки — вырезкой, а не картинкой.
 *
 * --- Почему не значок рядом с именем ----------------------------------------
 *
 * Значок папки на прямоугольной плашке — это подпись «здесь папка».
 * Вырезанная плашка папкой БЫВАЕТ: в ряду одинаковых прямоугольников её
 * видно, не читая. Бумага, свет по кромке и тень у неё при этом те же, что
 * у всего остального, — меняется одно очертание.
 *
 * --- Почему `clipPath`, а не картинка ----------------------------------------
 *
 * Фоновая картинка не умеет быть той же бумагой, что и соседи: цвет её
 * пришлось бы повторить второй раз и держать в согласии с темой, с
 * которой он меняется. Вырезка же работает поверх любой заливки — и над
 * ней по-прежнему лежит обычная разметка с именем и кнопками.
 *
 * Доли, а не точки (`objectBoundingBox`): очертание тянется за карточкой
 * на любой ширине. Отношение сторон у карточки при этом закреплено (4:3) —
 * иначе скругления стали бы овалами, а наклон плеча поехал бы вместе с
 * ними. Четыре к трём, а не два к одному, как было: папка — предмет, и
 * вытянутая вдвое она читается полкой, а не папкой.
 */
const FOLDER_CLIP = { clipPath: "url(#folder-shape)" } as const;

function FolderShape() {
  return (
    <svg aria-hidden className="absolute size-0" focusable="false">
      <defs>
        <clipPath id="folder-shape" clipPathUnits="objectBoundingBox">
          <path
            d="M0.05,0 H0.40 C0.435,0 0.455,0.024 0.47,0.0667 L0.49,0.12
               C0.502,0.156 0.52,0.1667 0.55,0.1667 H0.95
               A0.05,0.0667 0 0 1 1,0.2333 V0.9333
               A0.05,0.0667 0 0 1 0.95,1 H0.05 A0.05,0.0667 0 0 1 0,0.9333
               V0.0667 A0.05,0.0667 0 0 1 0.05,0 Z"
          />
        </clipPath>
      </defs>
    </svg>
  );
}

function FolderCard({
  folder,
  highlighted,
  renaming,
  hoverable,
  onRename,
  onCommit,
  onCancel,
  onOpen,
  onDelete,
}: {
  folder: LibraryFolder;
  highlighted: boolean;
  renaming: boolean;
  /** Есть ли указатель: от этого зависит, спрятаны ли кнопки до наведения. */
  hoverable: boolean;
  onRename: () => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      data-folder-drop={folder.id}
      // Свет по кромке вместо подсветки заливкой — и у наведения, и у
      // папки, над которой держат перетаскиваемый профиль. Вырезанную
      // форму нельзя обвести рамкой (`ring` отрезается вместе со всем,
      // что вышло за контур), а свет ложится ровно по очертанию.
      data-glow={highlighted ? "on" : undefined}
      style={FOLDER_CLIP}
      className="group lit-edge lit-edge--clipped lit-edge--rim aspect-[4/3]"
    >
      <div
        style={FOLDER_CLIP}
        // Отступ сверху — долей ШИРИНЫ, а не рёмами: у карточки
        // постоянное отношение сторон (4:3), и доля ширины растёт вместе с
        // высотой язычка. Рёмы на широкой карточке оставили бы имя в
        // вырезанной части — там, где бумаги ещё нет.
        className="lit-clipped relative flex size-full flex-col bg-paper-raised px-2.5 pt-[16%] pb-2.5"
      >
        {renaming ? (
          <NameField value={folder.name} onCommit={onCommit} onCancel={onCancel} />
        ) : (
          <>
            {/* Папка открывается нажатием куда угодно по бумаге, а не по
                одному имени: карточка и есть папка, и требовать попасть в
                строку текста — значит требовать точности там, где её
                неоткуда взять, особенно пальцем.

                Растянутая кнопка, а не кнопка вокруг всего: на карточке
                стоят ещё две (переименовать, удалить), а кнопка в кнопке —
                разметка, которой не бывает. Поэтому эта лежит подложкой, а
                соседи подняты над ней и ловят нажатие сами. */}
            <button
              type="button"
              onClick={onOpen}
              aria-label={`Открыть папку «${folder.name}»`}
              className="absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ink"
            />
            {/* Переименовать и удалить — в начале бумаги, у правого края.
                --------------------------------------------------------------
                Место это у папки свободно всегда: слева от него язычок,
                под ним имя, а справа от язычка первая строка бумаги ничем
                не занята. Кнопки успели постоять и внизу, рядом с именем,
                и в пустом углу над бумагой, и на самом язычке: внизу они
                были на плитке третьей вещью после очертания и имени, в
                углу под ними не было бумаги, а на язычке — шириной в два
                пальца — помещались впритык, задевая скос плеча.

                Заливки у них нет ни в покое, ни под указателем: на плитке
                и без того две вещи — очертание и имя, — и плашка под
                значком стала бы третьей. Наведение отвечает цветом самого
                значка, как отвечают ссылки.

                С указателем кнопки появляются при наведении на карточку —
                и при переходе на неё табуляцией (`focus-within`), иначе с
                клавиатуры до них было бы не добраться. Пальцем наведения
                не бывает, и там они видны всегда. */}
            <div
              className={cn(
                // Накладка, а не строка в столбце: строка отнимала у имени
                // высоту и опускала его ниже середины плитки, а имя здесь —
                // единственное, что читают. Поля у накладки те же, что у
                // бумаги (`px-2.5 pt-[16%]`), поэтому кнопки встают ровно
                // туда, где начинается её содержимое.
                "pointer-events-none absolute inset-0 flex items-start justify-end px-2.5 pt-[16%]",
                hoverable && [
                  // Прячется прозрачностью, а не `pointer-events`: чтобы
                  // нажать на кнопку мышью, к ней нужно сперва подвести
                  // указатель — а это и есть то наведение, от которого она
                  // появляется. Запрет нажатий добавил бы к этому только
                  // риск проглотить первое касание на экранах, где есть и
                  // палец, и мышь.
                  "opacity-0 transition-opacity duration-200",
                  "group-hover:opacity-100 group-focus-within:opacity-100",
                ],
              )}
            >
              {/* Нажатия ловят сами кнопки: ряд их не ловит вовсе
                  (`pointer-events-none` выше), иначе полоса поверх бумаги
                  съедала бы нажатие по карточке. */}
              <span className="pointer-events-auto flex items-center gap-0.5">
                <IconButton label={`Переименовать папку «${folder.name}»`} onClick={onRename} small>
                  <Pencil aria-hidden className="size-4" />
                </IconButton>
                <IconButton label={`Удалить папку «${folder.name}»`} onClick={onDelete} small>
                  <Trash2 aria-hidden className="size-4" />
                </IconButton>
              </span>
            </div>
            {/* Имя — посреди плитки: кнопки лежат накладкой и высоты у
                него не отнимают. Значка при нём нет — карточка сама имеет
                очертание папки, и значок повторял бы это второй раз. */}
            <span
              className={cn(
                "pointer-events-none relative flex flex-1 items-center justify-center",
                "text-center text-sm font-medium",
              )}
            >
              <span className="truncate">{folder.name}</span>
            </span>
          </>
        )}
      </div>
    </li>
  );
}

function EntryCard({
  entry,
  active,
  dragging,
  renaming,
  grip,
  previewed,
  onHover,
  onLeave,
  onOpen,
  onRename,
  onCommit,
  onCancel,
  onDelete,
}: {
  entry: LibraryEntry;
  active: boolean;
  dragging: boolean;
  renaming: boolean;
  grip: ReturnType<ReturnType<typeof useEntryDrag>["handlers"]>;
  /** Этот профиль сейчас показан наверху страницы. */
  previewed: boolean;
  /** Показать профиль наверху. Пусто там, где наведения не бывает. */
  onHover?: () => void;
  onLeave?: () => void;
  onOpen: () => void;
  onRename: () => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      onPointerEnter={onHover}
      onPointerLeave={onLeave}
      // Фокус с клавиатуры — то же наведение: человек, идущий по списку
      // табуляцией, видит наверху тот же профиль, что и человек с мышью.
      onFocus={onHover}
      onBlur={onLeave}
      // Показанный наверху светится и без указателя: на телефоне показ
      // включается нажатием, и иначе непонятно, о каком профиле говорят
      // цифры.
      //
      // `min-w-0 max-w-full` — про перенос по строкам (`ul` выше): без
      // первого длинное имя не даст строке ужаться и та вылезет за край,
      // без второго она вылезет за него сама.
      className={cn("min-w-0 max-w-full", dragging && "opacity-40")}
    >
      <div
        data-glow={previewed ? "on" : undefined}
        className="lit relative flex h-full items-center gap-2 rounded-xl bg-paper-raised py-1.5 pr-1.5 pl-1"
      >
        {renaming ? (
          <NameField value={entry.name} onCommit={onCommit} onCancel={onCancel} />
        ) : (
          <>
            {/* Нажатие по всей строке, а не по одному имени: строка и есть
                профиль. Кнопка лежит подложкой, а ручка и две кнопки над
                ней подняты (`relative`) и ловят нажатие сами. */}
            <button
              type="button"
              onClick={onOpen}
              aria-label={`Открыть профиль «${entry.name}»`}
              className="absolute inset-0 cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
            />

            <button
              type="button"
              {...grip}
              aria-label={`Перетащить профиль «${entry.name}» в папку`}
              title="Перетащите в папку или нажмите, чтобы выбрать её"
              className={cn(
                // Прокрутка на ручке выключена заранее: менять
                // `touch-action` посреди начатого жеста поздно
                // (`use-entry-drag.ts`).
                "touch-none relative inline-flex size-7 shrink-0 cursor-grab items-center justify-center",
                "rounded-lg text-ink-muted transition-colors hover:text-ink",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
              )}
            >
              <GripVertical aria-hidden className="size-4" />
            </button>

            {/* Всё в строку: ручка, имя, отметка «открыт». Имя жмётся
                первым — остальное короткое и своей длины не меняет.

                Времени последней правки здесь больше нет. Профили человек
                различает по имени, а не по минуте сохранения: дата стояла
                в каждой строке, повторяла из раза в раз сегодняшнее число
                и занимала под себя треть строки — ради сведения, к
                которому не возвращаются. Когда правили открытый профиль,
                по-прежнему сказано в подвале страницы. */}
            <span className="pointer-events-none relative min-w-0 flex-1 truncate text-sm font-medium">
              {entry.name}
            </span>
            {active ? (
              <span className="pointer-events-none relative shrink-0 rounded-md bg-paper-sunken px-1.5 py-0.5 text-xs text-ink-muted">
                открыт
              </span>
            ) : null}

            <span className="relative flex shrink-0 items-center">
              <IconButton label={`Переименовать профиль «${entry.name}»`} onClick={onRename}>
                <Pencil aria-hidden className="size-4" />
              </IconButton>
              {/* Открытый профиль отсюда не удаляется: стереть то, что
                  сейчас на экране, значило бы оставить страницу без
                  данных, которые она показывает. Для этого есть «Удалить
                  профиль» в настройках — там о последствиях сказано
                  прямо. */}
              <IconButton
                label={
                  active
                    ? "Открытый профиль удаляется из настроек"
                    : `Удалить профиль «${entry.name}»`
                }
                onClick={onDelete}
                disabled={active}
              >
                <Trash2 aria-hidden className="size-4" />
              </IconButton>
            </span>
          </>
        )}
      </div>

    </li>
  );
}

/**
 * Поле имени: набрали — Enter, передумали — Esc.
 *
 * Оно же и для новой папки, и для переименования: спрашивается одно и то
 * же, и заводить ради этого окно значило бы прервать человека посреди
 * списка ради одной строки.
 */
function NameField({
  value,
  placeholder,
  onCommit,
  onCancel,
}: {
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value);

  return (
    <Input
      autoFocus
      value={text}
      placeholder={placeholder}
      maxLength={200}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onCommit(text);
        if (event.key === "Escape") onCancel();
      }}
      // Уход из поля — согласие, а не отказ: человек набрал имя и нажал
      // мимо; терять набранное в этот момент он точно не просил.
      onBlur={() => onCommit(text)}
    />
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  small,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /**
   * Кнопка на папке: та же, но меньше.
   *
   * Стоит она во вкладке папки — в узкой полоске над её верхним краем, —
   * и восемь точек высоты там взять негде. Двадцать четыре остаётся:
   * меньше — цель, в которую не попадают (WCAG 2.5.8).
   */
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg",
        // Заливки под значком нет ни у той, ни у другой.
        // -------------------------------------------------------------------
        // Была у строчных: плашка под курсором, как у кнопок в окнах. Но
        // строка профиля сама нажимается — вся целиком, — и плашка внутри
        // неё читалась вторым, вложенным предметом: будто у строки есть
        // своя маленькая кнопка со своими краями. Наведению отвечает сам
        // значок, цветом, как отвечают ссылки; попасть в него помогает
        // размер, а не заливка.
        "text-ink-muted transition-colors hover:text-ink",
        small ? "size-6" : "size-8",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
      )}
    >
      {children}
    </button>
  );
}

