"use client";

import {
  ChevronDown,
  Lamp,
  Lightbulb,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import {
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  EVENT_COLOR_KEYS,
  EVENT_COLOR_TOKEN,
  MAX_CONFIGS,
  NAME_MAX,
  NO_APPEARANCE,
  activeHex,
  addConfig,
  isCustomised,
  isHex,
  paletteOf,
  removeConfig,
  selectConfig,
  updateConfig,
  withEventPalette,
  type Appearance,
  type EventColorKey,
  type Palette,
} from "@/components/shared/appearance";
import { saveAppearance, useAppearance } from "@/components/shared/use-appearance";
import { Button } from "@/components/ui/button";
import { DialogActions, DialogButton } from "@/components/ui/dialog-parts";
import { Input } from "@/components/ui/input";
import { MENU_ROW_HOVER } from "@/components/ui/menu-row";
import { Modal } from "@/components/ui/modal";
import { Card, Field } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { useSync } from "@/features/sync/ui/sync-provider";
import { cn } from "@/lib/utils/cn";

import { ABSENCE_LABELS, CALLOUT_LABELS } from "../schemas";
import { ABSENCE_MARK, ABSENCE_TONE, CALLOUT_MARK, CALLOUT_TONE } from "./day-marks";

const EVENT_LABEL: Record<EventColorKey, string> = {
  annual_leave: ABSENCE_LABELS.annual_leave,
  extra_leave: ABSENCE_LABELS.extra_leave,
  study_leave: ABSENCE_LABELS.study_leave,
  business_trip: ABSENCE_LABELS.business_trip,
  sick_leave: ABSENCE_LABELS.sick_leave,
  time_off_in_lieu: ABSENCE_LABELS.time_off_in_lieu,
  callout: CALLOUT_LABELS.callout,
};

/** Кому принадлежит список: лампе или одному из событий. */
type Scope = "lamp" | EventColorKey;

/** Что правят в окне: конфиг списка или (`id: null`) новый. */
interface Editing {
  scope: Scope;
  id: string | null;
}

const paletteFor = (appearance: Appearance, scope: Scope): Palette =>
  scope === "lamp" ? appearance.lamp : paletteOf(appearance, scope);

const withPalette = (appearance: Appearance, scope: Scope, palette: Palette): Appearance =>
  scope === "lamp"
    ? { ...appearance, lamp: { ...appearance.lamp, ...palette } }
    : withEventPalette(appearance, scope, palette);

/** Как клетка с этим событием выглядит на сетке — образец рядом с выбором цвета. */
function sample(key: EventColorKey): { tone: string; mark: string } {
  return key === "callout"
    ? { tone: CALLOUT_TONE, mark: CALLOUT_MARK }
    : { tone: ABSENCE_TONE[key], mark: ABSENCE_MARK[key] };
}

/**
 * Значение переменной корня из таблицы стилей — каким оно было бы без выбора.
 *
 * Свой цвет ставится на корень прямо в стиль и перекрывает таблицу, поэтому
 * прочитать стандартный цвет, пока выбран свой, можно только сняв выбор на
 * время чтения. Снятие и возврат идут подряд, без отрисовки между ними:
 * ничего не мигает.
 */
function stylesheetValue(property: string): string {
  // На сервере таблицы стилей нет: отдаём пустое, а образцы получат умолчание.
  if (typeof document === "undefined") return "";
  const root = document.documentElement;
  const inline = root.style.getPropertyValue(property);
  if (inline !== "") root.style.removeProperty(property);
  const value = getComputedStyle(root).getPropertyValue(property).trim();
  if (inline !== "") root.style.setProperty(property, inline);
  return value;
}

/** Стандартный цвет события в нынешней теме, `#rrggbb`. */
function standardEventColour(key: EventColorKey): string {
  const value = stylesheetValue(`--fps-${EVENT_COLOR_TOKEN[key]}`);
  return isHex(value) ? value.toLowerCase() : "#808080";
}

/** Каким светит лампа без своего цвета, `#rrggbb`. */
function standardLampColour(): string {
  const channels = stylesheetValue("--lamp-rgb").split(/\s+/).map(Number);
  if (channels.length !== 3 || channels.some((channel) => !Number.isInteger(channel))) {
    return "#a8e8ba";
  }
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

interface Standards {
  lamp: string;
  events: Record<EventColorKey, string>;
}

/** Серые образцы: что видно, пока таблицы стилей ещё нет (на сервере и при гидратации). */
const FALLBACK_STANDARDS = JSON.stringify({
  lamp: "#a8e8ba",
  events: Object.fromEntries(EVENT_COLOR_KEYS.map((key) => [key, "#808080"])),
});

function readStandards(): string {
  return JSON.stringify({
    lamp: standardLampColour(),
    events: Object.fromEntries(EVENT_COLOR_KEYS.map((key) => [key, standardEventColour(key)])),
  });
}

function subscribeTheme(onChange: () => void): () => void {
  const watcher = new MutationObserver(onChange);
  watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => watcher.disconnect();
}

/**
 * Стандартные цвета — какими были бы лампа и события без выбора.
 *
 * Читаются из таблицы стилей, а не заводятся второй раз в коде: они у светлой и
 * тёмной темы разные, и тема может смениться, пока настройки открыты, — поэтому
 * внешним источником, который следит за классом на корне. Снимок — строка:
 * объект React сравнивал бы по ссылке и зациклил бы подписку. На сервере и при
 * гидратации отдаются серые образцы, чтобы разметка совпала с серверной.
 */
function useStandards(): Standards {
  const raw = useSyncExternalStore(subscribeTheme, readStandards, () => FALLBACK_STANDARDS);
  return useMemo(() => JSON.parse(raw) as Standards, [raw]);
}

const COLOUR_INPUT = cn(
  "size-8 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0",
  "[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md",
  "[&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-0",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
);

const ICON_BUTTON = cn(
  "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg",
  "text-ink-faint transition-colors hover:text-ink",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
);

/** Плашка цвета: квадратик с тонкой рамкой, чтобы светлый цвет не терялся на светлой бумаге. */
function Swatch({ hex }: { hex: string }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: hex }}
      className="size-5 shrink-0 rounded-md border border-ink/20"
    />
  );
}

/**
 * Список конфигов одной палитры: стандартный цвет, свои, «добавить».
 *
 * Выбор — радиогруппа: родные `input type=radio` дают стрелки и один Tab на
 * группу без единой строки кода. Изменить и удалить — кнопки при строке, а не
 * внутри неё: вложенная кнопка в подписи радио нажималась бы вместе с ней.
 */
function ConfigList({
  palette,
  label,
  standard,
  onSelect,
  onAdd,
  onEdit,
  onRemove,
}: {
  palette: Palette;
  /** Что выбирают — для программы чтения: «Цвет света лампы». */
  label: string;
  /** Что показывает строка «Стандартный» — её цвет. */
  standard: { hex: string };
  onSelect: (id: string | null) => void;
  onAdd: () => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const group = useId();
  const full = palette.configs.length >= MAX_CONFIGS;

  const row = (id: string | null, hex: string, name: string) => (
    <label
      className={cn(
        "flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5",
        MENU_ROW_HOVER,
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink",
        palette.active === id && "bg-paper-sunken",
      )}
    >
      <input
        type="radio"
        name={group}
        checked={palette.active === id}
        onChange={() => onSelect(id)}
        className="peer sr-only"
      />
      <Swatch hex={hex} />
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{name}</span>
      {/* Метка выбранного — точка справа: цвет строки её не заменяет, он
          одинаков у выбранной и у той, на которую навели. */}
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full bg-ink opacity-0 transition-opacity peer-checked:opacity-100"
      />
    </label>
  );

  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1">
      <div className="flex items-center gap-1">
        {row(null, standard.hex, "Стандартный")}
        {/* Место под кнопки, чтобы точки выбора стояли в один столбец. */}
        <span aria-hidden className="w-[4.25rem] shrink-0" />
      </div>
      {palette.configs.map((config) => (
        <div key={config.id} className="flex items-center gap-1">
          {row(config.id, config.hex, config.name)}
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label={`Изменить: ${config.name}`}
            title="Изменить"
            onClick={() => onEdit(config.id)}
          >
            <Pencil aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label={`Удалить: ${config.name}`}
            title="Удалить"
            onClick={() => onRemove(config.id)}
          >
            <Trash2 aria-hidden className="size-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={onAdd}
        disabled={full}
        title={full ? `В списке не больше ${MAX_CONFIGS} цветов` : undefined}
        className={cn(
          "mt-1 inline-flex h-9 w-fit cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-ink-muted",
          "transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-50",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        )}
      >
        <Plus aria-hidden className="size-4" /> Добавить цвет
      </button>
    </div>
  );
}

/**
 * Окно одного конфига: название и цвет.
 *
 * Применяется по «Готово», а не на ходу: цвет, ещё не названный, не должен
 * перекрашивать страницу под окном. Крестик, Esc и нажатие мимо отменяют —
 * в списке остаётся то, что было. Окно пересоздаётся ключом (см. `key` у
 * вызова): начальные значения берутся заново для каждого конфига.
 */
function ConfigModal({
  open,
  title,
  lead,
  initial,
  creating,
  preview,
  onSave,
  onRemove,
  onClose,
}: {
  open: boolean;
  title: string;
  lead: string;
  initial: { name: string; hex: string };
  creating: boolean;
  /** Образец цвета: как он будет выглядеть там, где его применят. */
  preview: (hex: string) => ReactNode;
  onSave: (name: string, hex: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [hex, setHex] = useState(initial.hex);
  const nameId = useId();
  const colourId = useId();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      icon={<Lightbulb />}
      lead={lead}
      className="w-[min(28rem,calc(100vw-2rem))]"
      footer={
        <DialogActions>
          {creating ? null : (
            <DialogButton onClick={onRemove} className="text-signal hover:text-signal">
              <Trash2 aria-hidden /> Удалить
            </DialogButton>
          )}
          <DialogButton variant="primary" onClick={() => onSave(name, hex)}>
            Готово
          </DialogButton>
        </DialogActions>
      }
    >
      <Card>
        <Field id={nameId} label="Название">
          <Input
            id={nameId}
            data-autofocus=""
            value={name}
            maxLength={NAME_MAX}
            placeholder={hex.toUpperCase()}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSave(name, hex);
            }}
            className="w-48"
          />
        </Field>
        <Field id={colourId} label="Цвет">
          {preview(hex)}
          <input
            id={colourId}
            type="color"
            value={hex}
            onChange={(event) => setHex(event.target.value)}
            className={COLOUR_INPUT}
          />
        </Field>
      </Card>
    </Modal>
  );
}

/** Образец события с подставленным цветом: клетка такая, какой она встанет на сетке. */
function EventSample({ eventKey, hex }: { eventKey: EventColorKey; hex?: string }) {
  const { tone, mark } = sample(eventKey);
  const token = `--fps-${EVENT_COLOR_TOKEN[eventKey]}`;
  // Переменные перекрываются на самом образце: `@theme inline` подставляет их в
  // классы цвета прямо в месте употребления, и образец красится сам, не трогая
  // страницу под окном.
  const style =
    hex === undefined
      ? undefined
      : ({
          [token]: hex,
          [`${token}-soft`]: `color-mix(in srgb, ${hex} 14%, var(--fps-paper))`,
        } as CSSProperties);
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md border font-mono text-sm",
        tone,
      )}
    >
      {mark}
    </span>
  );
}

function ResetButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button type="button" variant="ghost" onClick={onClick}>
      <RotateCcw aria-hidden /> {children}
    </Button>
  );
}

/**
 * Свои цвета событий и света лампы — только у вошедших в учётную запись.
 *
 * Выбранное применяется сразу и ко всему приложению (`appearance.ts`), лежит на
 * устройстве и зеркалится в учётную запись (`features/sync`): оно едет на другие
 * устройства и уходит с этого при выходе. Невошедшему раздел показывает замок и
 * дорогу ко входу; если на устройстве осталось выбранное раньше или лампа
 * погашена, вернуть всё как было можно и так — сбросить не значит изменить, а
 * без этого погасшую лампу было бы нечем зажечь.
 */
export function AppearanceSettings() {
  const { enabled, account } = useSync();
  const appearance = useAppearance();

  if (account === null) {
    return (
      <div className="space-y-4">
        <Card>
          <div className="flex items-start gap-3 py-4">
            <Lock aria-hidden className="mt-0.5 size-4.5 shrink-0 text-ink-muted" />
            <div className="space-y-2 text-sm">
              <p className="text-ink">
                Свои цвета событий и света лампы, а также выключатель лампы доступны после
                входа в учётную запись: они хранятся в ней и приезжают на все ваши устройства.
              </p>
              {enabled ? (
                <Link href="/account" className="text-ink-muted underline hover:text-ink hover:no-underline">
                  Войти или зарегистрироваться
                </Link>
              ) : (
                <p className="text-ink-muted">Учётные записи появятся позже.</p>
              )}
            </div>
          </div>
        </Card>
        {isCustomised(appearance) ? (
          <ResetButton onClick={() => saveAppearance(NO_APPEARANCE)}>
            Сбросить оформление
          </ResetButton>
        ) : null}
      </div>
    );
  }

  return <AppearanceEditor />;
}

/** Содержимое раздела для вошедшего: выключатели и списки конфигов. */
export function AppearanceEditor() {
  const appearance = useAppearance();
  const standards = useStandards();
  const [editing, setEditing] = useState<Editing | null>(null);

  const palette = editing === null ? null : paletteFor(appearance, editing.scope);
  const target =
    editing === null || palette === null || editing.id === null
      ? undefined
      : palette.configs.find((config) => config.id === editing.id);

  const save = (next: Appearance) => saveAppearance(next);

  const select = (scope: Scope, id: string | null) =>
    save(withPalette(appearance, scope, selectConfig(paletteFor(appearance, scope), id)));

  const remove = (scope: Scope, id: string) =>
    save(withPalette(appearance, scope, removeConfig(paletteFor(appearance, scope), id)));

  function commit(name: string, hex: string) {
    if (editing === null) return;
    const current = paletteFor(appearance, editing.scope);
    const next =
      editing.id === null
        ? addConfig(current, { id: newId(), name, hex, createdAt: new Date().toISOString() })
        : updateConfig(current, editing.id, { name, hex });
    save(withPalette(appearance, editing.scope, next));
    setEditing(null);
  }

  const lampStandard = { hex: standards.lamp };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-ink">Лампа</h3>
        <Card>
          <div className="py-3">
            <Switch
              spread
              checked={appearance.lamp.on}
              onChange={(on) => save({ ...appearance, lamp: { ...appearance.lamp, on } })}
              label={
                <span className="inline-flex items-center gap-2">
                  <Lamp aria-hidden className="size-4 text-ink-muted" /> Лампа включена
                </span>
              }
            />
          </div>
          {appearance.lamp.on ? (
            <div className="py-3">
              <ConfigList
                palette={appearance.lamp}
                label="Цвет света лампы"
                standard={lampStandard}
                onSelect={(id) => select("lamp", id)}
                onAdd={() => setEditing({ scope: "lamp", id: null })}
                onEdit={(id) => setEditing({ scope: "lamp", id })}
                onRemove={(id) => remove("lamp", id)}
              />
            </div>
          ) : null}
        </Card>
        {appearance.lamp.on ? null : (
          <p className="text-xs leading-5 text-ink-muted">
            Лампа выключена: нет ни света под шапкой, ни бликов на кромках, ни каймы под
            курсором. Цвета в списке сохранены.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-ink">События</h3>
        <Card>
          <div className="py-3">
            <Switch
              spread
              checked={appearance.events.on}
              onChange={(on) => save({ ...appearance, events: { ...appearance.events, on } })}
              label="Свои цвета событий"
            />
          </div>
          {appearance.events.on
            ? EVENT_COLOR_KEYS.map((key) => {
                const own = paletteOf(appearance, key);
                const chosen = activeHex(own);
                const chosenName = own.configs.find((config) => config.id === own.active)?.name;
                return (
                  <details key={key} className="group py-2">
                    <summary
                      className={cn(
                        "flex cursor-pointer list-none items-center gap-3 rounded-lg py-1 [&::-webkit-details-marker]:hidden",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                      )}
                    >
                      <EventSample eventKey={key} hex={chosen ?? undefined} />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">
                        {EVENT_LABEL[key]}
                      </span>
                      <span className="max-w-[40%] truncate text-xs text-ink-muted">
                        {chosenName ?? "Стандартный"}
                      </span>
                      <ChevronDown
                        aria-hidden
                        className="size-4 shrink-0 text-ink-faint transition-transform group-open:rotate-180"
                      />
                    </summary>
                    <div className="pt-2 pl-11">
                      <ConfigList
                        palette={own}
                        label={`Цвет: ${EVENT_LABEL[key]}`}
                        standard={{ hex: standards.events[key] }}
                        onSelect={(id) => select(key, id)}
                        onAdd={() => setEditing({ scope: key, id: null })}
                        onEdit={(id) => setEditing({ scope: key, id })}
                        onRemove={(id) => remove(key, id)}
                      />
                    </div>
                  </details>
                );
              })
            : null}
        </Card>
        {appearance.events.on ? null : (
          <p className="text-xs leading-5 text-ink-muted">
            Свои цвета выключены: все события показаны стандартными. Цвета в списках сохранены.
          </p>
        )}
      </section>

      {isCustomised(appearance) ? (
        <ResetButton onClick={() => save(NO_APPEARANCE)}>Сбросить всё оформление</ResetButton>
      ) : null}

      {/* Одно окно на все списки: внутри закрытого `details` окно не показалось
          бы, а у каждого списка своё — это семь одинаковых окон в разметке. */}
      <ConfigModal
        key={editing === null ? "none" : `${editing.scope}:${editing.id ?? "new"}`}
        open={editing !== null}
        title={editing?.id === null ? "Новый цвет" : "Изменить цвет"}
        lead={
          editing === null
            ? ""
            : editing.scope === "lamp"
              ? "Свет лампы"
              : EVENT_LABEL[editing.scope]
        }
        creating={editing?.id === null}
        initial={{
          name: target?.name ?? "",
          hex:
            target?.hex ??
            (editing === null
              ? "#808080"
              : editing.scope === "lamp"
                ? standards.lamp
                : (activeHex(paletteOf(appearance, editing.scope)) ??
                  standards.events[editing.scope])),
        }}
        preview={(hex) =>
          editing === null || editing.scope === "lamp" ? (
            <Swatch hex={hex} />
          ) : (
            <EventSample eventKey={editing.scope} hex={hex} />
          )
        }
        onSave={commit}
        onRemove={() => {
          if (editing !== null && editing.id !== null) remove(editing.scope, editing.id);
          setEditing(null);
        }}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

/** Номер нового конфига: уникальный в списке и стабильный между перезагрузками. */
function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
