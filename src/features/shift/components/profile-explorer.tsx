"use client";

import { ChevronLeft, Folder, GripVertical, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LitEdgeGlow, trackGlow } from "@/components/ui/lit-edge";
import { Input } from "@/components/ui/input";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils/cn";

import {
  activeEntryId,
  createFolder,
  deleteEntry,
  deleteFolder,
  detachActive,
  importEntry,
  loadLibrary,
  moveEntry,
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
      pickProfileFile((profile) => importEntry(profile, folderId), setError);
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
  onCreated,
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
  /** Создан новый профиль: он становится открытым. */
  onCreated: (profile: StoredProfile) => void;
}) {
  const { library, activeId } = useLibrary();
  const [renaming, setRenaming] = useState<Rename | null>(null);
  const [removing, setRemoving] = useState<Removal | null>(null);
  const [movingEntry, setMovingEntry] = useState<string | null>(null);

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
  const atRoot = current.id === ROOT_FOLDER_ID;
  const entries = library.entries
    .filter((entry) => entry.folderId === current.id)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));

  const { drag, handlers } = useEntryDrag({
    onDrop: moveEntry,
    onTap: (entryId) => setMovingEntry((open) => (open === entryId ? null : entryId)),
  });

  function commitRename(value: string) {
    if (renaming === null) return;
    const name = value.trim();
    if (name !== "") {
      if (renaming.kind === "folder") renameFolder(renaming.id, name);
      // Имя открытого профиля правится на самой странице, а не в перечне:
      // в перечень оно придёт отражением (`syncActiveIntoLibrary`), и двух
      // разных имён у одного графика не случится.
      else if (renaming.id === activeId) {
        onChange((previous) => ({ ...previous, displayName: name }));
      } else renameEntry(renaming.id, name);
    }
    setRenaming(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {atRoot ? (
          <h2 className="font-display text-lg">{current.name}</h2>
        ) : (
          <div className="flex items-center gap-1">
            {/* Возврат — он же место, куда можно перетащить профиль из
                папки наружу: другого пути «вверх» у одного уровня нет. */}
            <button
              type="button"
              data-folder-drop={ROOT_FOLDER_ID}
              onClick={() => tools.openFolder(ROOT_FOLDER_ID)}
              data-glow={drag?.over === ROOT_FOLDER_ID ? "on" : undefined}
              onPointerMove={trackGlow}
              className={cn(
                "lit-edge inline-flex h-9 cursor-pointer items-center gap-1 rounded-xl px-2",
                "text-sm text-ink-muted transition-colors hover:text-ink",
              )}
            >
              <LitEdgeGlow className="rounded-xl" />
              <ChevronLeft aria-hidden className="size-4" />
              {ROOT_FOLDER_ID}
            </button>
            <h2 className="font-display text-lg">{current.name}</h2>
          </div>
        )}
      </div>

      {tools.error ? (
        <p className="rounded-xl bg-signal-soft px-4 py-3 text-sm">{tools.error}</p>
      ) : null}

      <FolderShape />

      {/* Папки — только в grafik13: внутрь друг друга они не вкладываются.
          В один столбец на самом узком телефоне: вдвоём на 320 точках у
          карточек остаётся по 132, и в них не встают ни имя папки, ни
          «0 профилей» рядом с двумя кнопками. */}
      {atRoot ? (
        <ul className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {library.folders
            .filter((folder) => folder.id !== ROOT_FOLDER_ID)
            .map((folder) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                count={library.entries.filter((entry) => entry.folderId === folder.id).length}
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
                  if (name !== "") createFolder(name);
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
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 empty:hidden">
        {entries.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            active={entry.id === activeId}
            dragging={drag?.moved === true && drag.entryId === entry.id}
            renaming={renaming?.kind === "entry" && renaming.id === entry.id}
            folders={library.folders}
            moving={movingEntry === entry.id}
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
            onMove={(target) => {
              moveEntry(entry.id, target);
              setMovingEntry(null);
            }}
            onCloseMove={() => setMovingEntry(null)}
            onDelete={() => setRemoving({ kind: "entry", id: entry.id, name: entry.name })}
          />
        ))}
      </ul>

      {entries.length === 0 ? (
        <p className="rounded-xl bg-paper-raised px-4 py-6 text-center text-sm text-ink-muted lit">
          {atRoot
            ? "Здесь будут ваши графики. Создайте новый профиль или загрузите сохранённый файл."
            : "Папка пуста. Перетащите сюда профиль за полоску в углу плитки."}
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
            Папка «{removing.name}» исчезнет, а профили из неё вернутся в{" "}
            {ROOT_FOLDER_ID}. Данные не пропадут.
          </p>
        ) : (
          <p>
            Профиль «{removing?.name}» будет стёрт с устройства вместе со всеми
            внесёнными отпусками и правками календаря. Отменить будет нельзя:
            копии на сервере нет.
          </p>
        )}
      </ConfirmDialog>

      <CreateProfileModal
        open={tools.creating}
        onClose={tools.closeCreate}
        onCreated={(profile) => {
          // Новый профиль — новая запись: без этого его первая же правка
          // легла бы поверх снимка того графика, что открыт сейчас.
          detachActive();
          tools.closeCreate();
          onCreated(profile);
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
 */
function useLibrary(): { library: Library; activeId: string | null } {
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
 * на любой ширине. Отношение сторон у карточки при этом закреплено (2:1) —
 * иначе скругления стали бы овалами, а наклон плеча поехал бы вместе с
 * ними.
 */
const FOLDER_CLIP = { clipPath: "url(#folder-shape)" } as const;

function FolderShape() {
  return (
    <svg aria-hidden className="absolute size-0" focusable="false">
      <defs>
        <clipPath id="folder-shape" clipPathUnits="objectBoundingBox">
          <path
            d="M0.05,0 H0.33 C0.365,0 0.385,0.024 0.4,0.08 L0.42,0.15
               C0.432,0.186 0.45,0.2 0.48,0.2 H0.95 A0.05,0.1 0 0 1 1,0.3
               V0.9 A0.05,0.1 0 0 1 0.95,1 H0.05 A0.05,0.1 0 0 1 0,0.9
               V0.1 A0.05,0.1 0 0 1 0.05,0 Z"
          />
        </clipPath>
      </defs>
    </svg>
  );
}

function FolderCard({
  folder,
  count,
  highlighted,
  renaming,
  onRename,
  onCommit,
  onCancel,
  onOpen,
  onDelete,
}: {
  folder: LibraryFolder;
  count: number;
  highlighted: boolean;
  renaming: boolean;
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
      onPointerMove={trackGlow}
      className="lit-edge lit-edge--rim aspect-[2/1]"
    >
      <LitEdgeGlow style={FOLDER_CLIP} />
      <div
        style={FOLDER_CLIP}
        // Отступ сверху — долей ШИРИНЫ, а не рёмами: у карточки
        // постоянное отношение сторон (2:1), и доля ширины растёт вместе с
        // высотой язычка. Рёмы на широкой карточке оставили бы имя в
        // вырезанной части — там, где бумаги ещё нет.
        className="lit-clipped relative flex size-full flex-col gap-0.5 bg-paper-raised px-3 pt-[13%] pb-2.5"
      >
        {renaming ? (
          <NameField value={folder.name} onCommit={onCommit} onCancel={onCancel} />
        ) : (
          <>
            {/* Папка открывается нажатием куда угодно по карточке, а не по
                одному имени: карточка и есть папка, и требовать попасть в
                строку текста — значит требовать точности там, где её неоткуда
                взять, особенно пальцем.

                Растянутая кнопка, а не кнопка вокруг всего: внутри карточки
                стоят ещё две (переименовать, удалить), а кнопка в кнопке —
                разметка, которой не бывает. Поэтому эта лежит подложкой, а
                соседи подняты над ней (`relative`) и ловят нажатие сами. */}
            <button
              type="button"
              onClick={onOpen}
              aria-label={`Открыть папку «${folder.name}»`}
              className="absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-trace"
            />
            {/* Строки не ловят указатель целиком — ловят только две кнопки:
                иначе они, лежащие поверх подложки, съедали бы нажатие по
                середине карточки, то есть по самому вероятному месту.

                Значка папки при имени больше нет: карточка сама имеет
                очертание папки, и значок повторял бы это второй раз — да
                ещё и отнимал бы у имени треть строки на узкой плитке. */}
            <div className="pointer-events-none relative flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {folder.name}
              </span>
              <span className="pointer-events-auto flex shrink-0 items-center gap-0.5">
                <IconButton label={`Переименовать папку «${folder.name}»`} onClick={onRename}>
                  <Pencil aria-hidden className="size-4" />
                </IconButton>
                <IconButton label={`Удалить папку «${folder.name}»`} onClick={onDelete}>
                  <Trash2 aria-hidden className="size-4" />
                </IconButton>
              </span>
            </div>
            <span className="pointer-events-none relative truncate text-xs text-ink-muted">
              {profileCount(count)}
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
  folders,
  moving,
  grip,
  previewed,
  onHover,
  onLeave,
  onOpen,
  onRename,
  onCommit,
  onCancel,
  onMove,
  onCloseMove,
  onDelete,
}: {
  entry: LibraryEntry;
  active: boolean;
  dragging: boolean;
  renaming: boolean;
  folders: LibraryFolder[];
  moving: boolean;
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
  onMove: (folderId: string) => void;
  onCloseMove: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      onPointerEnter={onHover}
      onPointerMove={trackGlow}
      onPointerLeave={onLeave}
      // Фокус с клавиатуры — то же наведение: человек, идущий по списку
      // табуляцией, видит наверху тот же профиль, что и человек с мышью.
      onFocus={onHover}
      onBlur={onLeave}
      // Показанный наверху светится и без указателя: на телефоне показ
      // включается нажатием, и иначе непонятно, о каком профиле говорят
      // цифры.
      data-glow={previewed ? "on" : undefined}
      className={cn("lit-edge", dragging && "opacity-40")}
    >
      <LitEdgeGlow className="rounded-[0.875rem]" />

      <div className="lit relative flex h-full flex-col gap-1 rounded-xl bg-paper-raised p-3">
        {renaming ? (
          <NameField value={entry.name} onCommit={onCommit} onCancel={onCancel} />
        ) : (
          <>
            {/* Нажатие по всей плитке, а не по одному имени: плитка и есть
                профиль. Кнопка лежит подложкой, а ручка и две кнопки над
                ней подняты (`relative`) и ловят нажатие сами. */}
            <button
              type="button"
              onClick={onOpen}
              aria-label={`Открыть профиль «${entry.name}»`}
              className="absolute inset-0 cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-trace"
            />

            <span className="pointer-events-none relative block truncate text-sm font-medium">
              {entry.name}
            </span>
            {/* Перенос, а не обрезка: на 320 точках отметка «открыт» и
                время правки в одну строку не встают, и обрезалось бы
                именно время — то самое, чем два снимка и различают. */}
            <span className="pointer-events-none relative flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-muted">
              {active ? (
                <span className="shrink-0 rounded-md bg-paper-sunken px-1.5 py-0.5 font-normal">
                  открыт
                </span>
              ) : null}
              <span className="truncate">
                {/* Слово уходит с самых узких экранов, дата остаётся:
                    столбец с именем там шириной в 120 точек, и «изменён»
                    съедало ровно то время, ради которого строка и стоит.
                    Программе чтения слово остаётся (`sr-only`). */}
                <span className="max-[359px]:sr-only">{"изменён "}</span>
                {savedAtLabel(entry.savedAt)}
              </span>
            </span>

            <div className="relative mt-auto flex items-center justify-between gap-1 pt-2">
              <button
                type="button"
                {...grip}
                aria-label={`Переместить профиль «${entry.name}» в папку`}
                title="Перетащите в папку или нажмите, чтобы выбрать её"
                className={cn(
                  // Прокрутка на ручке выключена заранее: менять
                  // `touch-action` посреди начатого жеста поздно
                  // (`use-entry-drag.ts`).
                  "touch-none inline-flex size-8 shrink-0 cursor-grab items-center justify-center",
                  "rounded-lg text-ink-muted transition-colors hover:text-ink",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace",
                )}
              >
                <GripVertical aria-hidden className="size-4" />
              </button>

              <span className="flex items-center gap-1">
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
            </div>

            {/* Перечень папок — тот же перенос для тех, кому перетаскивание
                недоступно: с клавиатуры или дрожащей рукой. */}
            {moving ? (
              <div className="relative flex flex-wrap items-center gap-2 pt-2">
                {folders
                  .filter((folder) => folder.id !== entry.folderId)
                  .map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => onMove(folder.id)}
                      className={cn(
                        "inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg bg-paper px-2",
                        "text-xs transition-colors hover:bg-paper-sunken",
                      )}
                    >
                      <Folder aria-hidden className="size-3.5 text-ink-muted" />
                      {folder.name}
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={onCloseMove}
                  className="cursor-pointer text-xs text-ink-muted hover:underline"
                >
                  Отмена
                </button>
              </div>
            ) : null}
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
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
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
        "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg",
        "text-ink-muted transition-colors hover:bg-paper-sunken hover:text-ink",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace",
      )}
    >
      {children}
    </button>
  );
}

function profileCount(count: number): string {
  const last = count % 10;
  const teen = count % 100 >= 11 && count % 100 <= 14;
  if (!teen && last === 1) return `${count} профиль`;
  if (!teen && last >= 2 && last <= 4) return `${count} профиля`;
  return `${count} профилей`;
}

/**
 * Когда профиль правили в последний раз.
 *
 * Месяц сокращён намеренно: строка стоит под именем в списке, а на
 * трёхсотдевяностоточечном экране «1 сентября 2025 г. в 10:00» не
 * помещается и обрывается многоточием ровно на времени — то есть на том,
 * чем два соседних снимка и различают.
 */
function savedAtLabel(savedAt: string): string {
  const date = new Date(savedAt);
  // Читается следом за словом «изменён», которое стоит в разметке рядом.
  if (Number.isNaN(date.getTime())) return "неизвестно когда";
  // Год — только чужой. У правки этого года он не сообщает ничего, а
  // строке на 320 точках стоит четверти ширины, и обрезалось из-за него
  // время — то самое, чем два снимка одного дня и различают.
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    ...(thisYear ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}
