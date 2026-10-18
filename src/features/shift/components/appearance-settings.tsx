"use client";

import { Lock, RotateCcw } from "lucide-react";
import Link from "next/link";

import {
  EVENT_COLOR_KEYS,
  EVENT_COLOR_TOKEN,
  NO_APPEARANCE,
  isCustomised,
  isHex,
  type EventColorKey,
} from "@/components/shared/appearance";
import { saveAppearance, useAppearance } from "@/components/shared/use-appearance";
import { Button } from "@/components/ui/button";
import { Card, Field } from "@/components/ui/panel";
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

/** Как клетка с этим событием выглядит на сетке — образец рядом с выбором цвета. */
function sample(key: EventColorKey): { tone: string; mark: string } {
  return key === "callout"
    ? { tone: CALLOUT_TONE, mark: CALLOUT_MARK }
    : { tone: ABSENCE_TONE[key], mark: ABSENCE_MARK[key] };
}

/** Какого цвета событие сейчас, пока своего не выбрано: из таблицы стилей, для нынешней темы. */
function defaultColour(token: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(`--fps-${token}`)
    .trim();
  return isHex(value) ? value.toLowerCase() : "#808080";
}

/** Каким светит лампа сейчас, пока цвет не выбран: `--lamp-rgb` корня как `#rrggbb`. */
function lampColour(): string {
  const channels = getComputedStyle(document.documentElement)
    .getPropertyValue("--lamp-rgb")
    .trim()
    .split(/\s+/)
    .map(Number);
  if (channels.length !== 3 || channels.some((channel) => !Number.isInteger(channel))) {
    return "#a8e8ba";
  }
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

const COLOUR_INPUT = cn(
  "size-8 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0",
  "[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md",
  "[&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-0",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
);

function ResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex size-6 cursor-pointer items-center justify-center rounded-lg",
        "text-ink-faint transition-colors hover:text-ink",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
      )}
    >
      <RotateCcw aria-hidden className="size-4" />
    </button>
  );
}

/**
 * Свои цвета событий и света лампы — только у вошедших в учётную запись.
 *
 * Выбранное применяется сразу и ко всему приложению (`appearance.ts`) и лежит в
 * этом браузере. Невошедшему раздел показывает замок и дорогу ко входу; если
 * цвета выбраны раньше, их можно сбросить и так — сбросить не значит изменить.
 */
export function AppearanceSettings() {
  const { enabled, account } = useSync();
  const appearance = useAppearance();
  const custom = isCustomised(appearance);

  if (account === null) {
    return (
      <div className="space-y-4">
        <Card>
          <div className="flex items-start gap-3 py-4">
            <Lock aria-hidden className="mt-0.5 size-4.5 shrink-0 text-ink-muted" />
            <div className="space-y-2 text-sm">
              <p className="text-ink">
                Свои цвета событий и света лампы доступны после входа в учётную запись.
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
        {custom ? (
          <Button type="button" variant="ghost" onClick={() => saveAppearance(NO_APPEARANCE)}>
            <RotateCcw aria-hidden /> Сбросить выбранные цвета
          </Button>
        ) : null}
      </div>
    );
  }

  const pick = (key: EventColorKey, hex: string) =>
    saveAppearance({ ...appearance, events: { ...appearance.events, [key]: hex } });

  const clear = (key: EventColorKey) => {
    const events = { ...appearance.events };
    delete events[key];
    saveAppearance({ ...appearance, events });
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-ink">События</h3>
        <Card>
          {EVENT_COLOR_KEYS.map((key) => {
            const chosen = appearance.events[key];
            const { tone, mark } = sample(key);
            return (
              <Field key={key} label={EVENT_LABEL[key]}>
                {chosen === undefined ? null : (
                  <ResetButton
                    label={`Вернуть цвет по умолчанию: ${EVENT_LABEL[key]}`}
                    onClick={() => clear(key)}
                  />
                )}
                <span
                  aria-hidden
                  className={cn(
                    "inline-flex size-8 shrink-0 items-center justify-center border font-mono text-sm",
                    tone,
                  )}
                >
                  {mark}
                </span>
                <input
                  type="color"
                  aria-label={`Цвет: ${EVENT_LABEL[key]}`}
                  value={chosen ?? defaultColour(EVENT_COLOR_TOKEN[key])}
                  onChange={(event) => pick(key, event.target.value)}
                  className={COLOUR_INPUT}
                />
              </Field>
            );
          })}
        </Card>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-ink">Лампа</h3>
        <Card>
          <Field label="Цвет света">
            {appearance.lamp === null ? null : (
              <ResetButton
                label="Вернуть свет лампы по умолчанию"
                onClick={() => saveAppearance({ ...appearance, lamp: null })}
              />
            )}
            <input
              type="color"
              aria-label="Цвет света лампы"
              value={appearance.lamp ?? lampColour()}
              onChange={(event) => saveAppearance({ ...appearance, lamp: event.target.value })}
              className={COLOUR_INPUT}
            />
          </Field>
        </Card>
        <p className="text-xs leading-5 text-ink-muted">
          Нажатие на саму лампу возвращает ей собственные цвета.
        </p>
      </section>

      {custom ? (
        <Button type="button" variant="ghost" onClick={() => saveAppearance(NO_APPEARANCE)}>
          <RotateCcw aria-hidden /> Сбросить все цвета
        </Button>
      ) : null}

      <p className="text-xs leading-5 text-ink-faint">
        Цвета хранятся в этом браузере и одинаковы в светлой и тёмной теме.
      </p>
    </div>
  );
}
