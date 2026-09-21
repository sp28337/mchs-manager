"use client";

import {
  ChevronLeft,
  Folder,
  FolderPlus,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
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
 */

export function ProfileExplorer({
  onChange,
  onOpenEntry,
  onCreated,
}: {
  /** Правка открытого профиля: ею переименовывается открытая запись. */
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  /** Человек выбрал профиль. Спросить про нынешний и открыть — забота вызывающего. */
  onOpenEntry: (entry: LibraryEntry) => void;
  /** Создан новый профиль: он становится открытым. */
  onCreated: (profile: StoredProfile) => void;
}) {
  const { library, activeId } = useLibrary();
  const [folderId, setFolderId] = useState(ROOT_FOLDER_ID);
  const [renaming, setRenaming] = useState<Rename | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [removing, setRemoving] = useState<Removal | null>(null);
  const [movingEntry, setMovingEntry] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Папка могла исчезнуть, пока её содержимое было открыто, — в соседней
  // вкладке или тем же человеком до входа сюда. Показывать пустоту с
  // заголовком удалённой папки нельзя, поэтому возврат к grafik13.
  const current =
    library.folders.find((folder) => folder.id === folderId) ?? library.folders[0]!;
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
              onClick={() => setFolderId(ROOT_FOLDER_ID)}
              className={cn(
                "inline-flex h-9 cursor-pointer items-center gap-1 rounded-xl px-2",
                "text-sm text-ink-muted transition-colors hover:bg-paper-raised",
                drag?.over === ROOT_FOLDER_ID && "bg-paper-raised text-ink ring-2 ring-trace",
              )}
            >
              <ChevronLeft aria-hidden className="size-4" />
              {ROOT_FOLDER_ID}
            </button>
            <h2 className="font-display text-lg">{current.name}</h2>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <ToolButton icon={<FolderPlus aria-hidden className="size-4" />} onClick={() => setAddingFolder(true)}>
            Папка
          </ToolButton>
          <ToolButton icon={<Plus aria-hidden className="size-4" />} onClick={() => setCreating(true)}>
            Профиль
          </ToolButton>
          <ToolButton
            icon={<Upload aria-hidden className="size-4" />}
            onClick={() => fileInput.current?.click()}
          >
            Из файла
          </ToolButton>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl bg-signal-soft px-4 py-3 text-sm">{error}</p>
      ) : null}

      {/* Папки — только в grafik13: внутрь друг друга они не вкладываются. */}
      {atRoot ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
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
                onOpen={() => setFolderId(folder.id)}
                onDelete={() => setRemoving({ kind: "folder", id: folder.id, name: folder.name })}
              />
            ))}
          {addingFolder ? (
            <li className="rounded-xl bg-paper-raised p-2 lit">
              <NameField
                value=""
                placeholder="Имя папки"
                onCommit={(value) => {
                  const name = value.trim();
                  if (name !== "") createFolder(name);
                  setAddingFolder(false);
                }}
                onCancel={() => setAddingFolder(false)}
              />
            </li>
          ) : null}
        </ul>
      ) : null}

      <ul className="divide-y divide-rule rounded-xl bg-paper-raised px-4 lit empty:hidden">
        {entries.map((entry) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            active={entry.id === activeId}
            dragging={drag?.moved === true && drag.entryId === entry.id}
            renaming={renaming?.kind === "entry" && renaming.id === entry.id}
            folders={library.folders}
            moving={movingEntry === entry.id}
            grip={handlers(entry.id, entry.name)}
            onOpen={() => onOpenEntry(entry)}
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

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        // Поле не сбрасывается само: выбрав тот же файл второй раз, человек
        // не получил бы события вовсе — значение не изменилось.
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setError(null);
          try {
            // Файл ложится в проводник ЗАПИСЬЮ, а не открывается сразу:
            // человек пришёл сюда за списком графиков, и подменять ему
            // открытый профиль, пока он только пополняет список, нельзя.
            importEntry(importProfile(await file.text()), current.id);
          } catch (cause) {
            setError(
              cause instanceof Error
                ? `${cause.message} Нужен файл, сохранённый этим же приложением.`
                : "Файл не прочитан.",
            );
          }
        }}
      />

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
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(profile) => {
          // Новый профиль — новая запись: без этого его первая же правка
          // легла бы поверх снимка того графика, что открыт сейчас.
          detachActive();
          setCreating(false);
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

function ToolButton({
  icon,
  children,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // Тот же вид, что у кнопок шапки (`header-tools.tsx`): это действия
        // одного рода, и выглядеть они обязаны одинаково.
        "lit inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-xl",
        "bg-paper-raised px-3 text-sm font-medium text-ink",
        "transition-colors hover:bg-paper-sunken",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace",
      )}
    >
      <span className="text-ink-muted">{icon}</span>
      {children}
    </button>
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
      className={cn(
        "lit flex flex-col gap-1 rounded-xl bg-paper-raised p-3 transition-shadow",
        highlighted && "ring-2 ring-trace",
      )}
    >
      {renaming ? (
        <NameField value={folder.name} onCommit={onCommit} onCancel={onCancel} />
      ) : (
        <>
          <button
            type="button"
            onClick={onOpen}
            className="flex cursor-pointer items-center gap-2 text-left text-sm font-medium"
          >
            <Folder aria-hidden className="size-4 shrink-0 text-ink-muted" />
            <span className="truncate">{folder.name}</span>
          </button>
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs text-ink-muted">{profileCount(count)}</span>
            <span className="flex items-center gap-1">
              <IconButton label={`Переименовать папку «${folder.name}»`} onClick={onRename}>
                <Pencil aria-hidden className="size-4" />
              </IconButton>
              <IconButton label={`Удалить папку «${folder.name}»`} onClick={onDelete}>
                <Trash2 aria-hidden className="size-4" />
              </IconButton>
            </span>
          </div>
        </>
      )}
    </li>
  );
}

function EntryRow({
  entry,
  active,
  dragging,
  renaming,
  folders,
  moving,
  grip,
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
  onOpen: () => void;
  onRename: () => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
  onMove: (folderId: string) => void;
  onCloseMove: () => void;
  onDelete: () => void;
}) {
  return (
    <li className={cn("py-2", dragging && "opacity-40")}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...grip}
          aria-label={`Переместить профиль «${entry.name}» в папку`}
          title="Перетащите в папку или нажмите, чтобы выбрать её"
          className={cn(
            // Прокрутка на ручке выключена заранее: менять `touch-action`
            // посреди начатого жеста поздно (`use-entry-drag.ts`).
            "touch-none inline-flex size-8 shrink-0 cursor-grab items-center justify-center",
            "rounded-lg text-ink-muted transition-colors hover:bg-paper-sunken hover:text-ink",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace",
          )}
        >
          <GripVertical aria-hidden className="size-4" />
        </button>

        {renaming ? (
          <NameField value={entry.name} onCommit={onCommit} onCancel={onCancel} />
        ) : (
          <>
            <button
              type="button"
              onClick={onOpen}
              className="flex-1 cursor-pointer truncate text-left"
            >
              <span className="block truncate text-sm font-medium">
                {entry.name}
                {active ? (
                  <span className="ml-2 rounded-md bg-paper-sunken px-1.5 py-0.5 text-xs font-normal text-ink-muted">
                    открыт
                  </span>
                ) : null}
              </span>
              <span className="block truncate text-xs text-ink-muted">
                {savedAtLabel(entry.savedAt)}
              </span>
            </button>

            <IconButton label={`Переименовать профиль «${entry.name}»`} onClick={onRename}>
              <Pencil aria-hidden className="size-4" />
            </IconButton>
            {/* Открытый профиль отсюда не удаляется: стереть то, что сейчас
                на экране, значило бы оставить страницу без данных, которые
                она показывает. Для этого есть «Удалить профиль» в
                настройках — там о последствиях сказано прямо. */}
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
          </>
        )}
      </div>

      {/* Перечень папок — тот же перенос для тех, кому перетаскивание
          недоступно: с клавиатуры или дрожащей рукой. */}
      {moving ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-10">
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
  if (Number.isNaN(date.getTime())) return "время правки неизвестно";
  return `изменён ${date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
