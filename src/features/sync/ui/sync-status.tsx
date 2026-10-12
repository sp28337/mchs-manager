"use client";

import Link from "next/link";

import { useSync } from "./sync-provider";

/**
 * Одна строка о состоянии синхронизации.
 *
 * Стоит в подвале рабочего экрана, рядом со временем последней правки:
 * человек приходит сюда не за синхронизацией, и места ей отведено
 * столько, сколько нужно, чтобы ответить на один вопрос — «моё уехало?».
 *
 * --- Почему «нет связи» сказано так же спокойно, как «синхронизировано»
 *
 * Потому что делать человеку в этом случае нечего: расчёт, правки и
 * проводник работают в браузере, как работали до появления аккаунта, а
 * уехать правки успеют сами. Красным цветом и восклицательным знаком
 * здесь сообщалось бы о беде, которой нет.
 */
export function SyncStatus() {
  const { enabled, phase, account, syncedAt, dirty, report } = useSync();

  if (!enabled) return null;

  if (phase === "signed-out" || account === null) {
    return (
      <span className="text-ink-faint">
        <Link href="/account" className="hover:underline">
          Синхронизация между устройствами
        </Link>
      </span>
    );
  }

  const принято = report === null ? 0 : report.received + report.deleted;

  const слова =
    phase === "syncing"
      ? "Синхронизация…"
      : phase === "offline"
        ? "Нет связи — правки уедут позже"
        : phase === "error"
          ? "Синхронизация отложена"
          : dirty
            ? "Есть изменения — уедут через мгновение"
            : принято > 0
              ? `Синхронизировано · принято с другого устройства: ${принято}`
              : syncedAt === null
                ? "Синхронизация настроена"
                : `Синхронизировано ${когда(syncedAt)}`;

  return (
    <span className="text-ink-faint">
      <Link href="/account" className="hover:underline">
        {слова}
      </Link>
    </span>
  );
}

function когда(время: string): string {
  const прошло = Date.now() - Date.parse(время);

  if (прошло < 60_000) return "только что";
  if (прошло < 60 * 60_000) return `${Math.round(прошло / 60_000)} мин назад`;

  return new Date(время).toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
