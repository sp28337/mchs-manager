"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ApiClient } from "../api/client";
import { verifyEmail } from "../session";
import { AuthFrame } from "./auth-screen";
import { SYNC_ENABLED } from "./enabled";
import { explain } from "./messages";

/**
 * Подтверждение адреса: страница делает одно действие и говорит исход.
 *
 * Токен берётся из строки запроса в браузере — у статического сайта
 * серверного обработчика нет. Отправляется он один раз: `useEffect` в
 * режиме строгой проверки вызывается дважды, а ссылка одноразовая, и
 * второй вызов получил бы `token_revoked` — то есть человек увидел бы
 * отказ на удачном подтверждении.
 */
export function VerifyEmailScreen() {
  const [состояние, setСостояние] = useState<"идёт" | "готово" | "отказ">("идёт");
  const [сообщение, setСообщение] = useState<string | null>(null);
  const отправлено = useRef(false);

  useEffect(() => {
    if (!SYNC_ENABLED || отправлено.current) return;
    отправлено.current = true;

    // Действие начинается после отрисовки, а не во время неё: страница
    // сперва говорит «проверяем ссылку», и только потом приходит исход.
    void (async () => {
      const token = new URLSearchParams(window.location.search).get("token");

      if (token === null || token.length < 16) {
        setСостояние("отказ");
        setСообщение("В ссылке нет кода подтверждения. Откройте её из письма целиком.");
        return;
      }

      try {
        await verifyEmail(new ApiClient(), token);
        setСостояние("готово");
      } catch (error) {
        setСостояние("отказ");
        setСообщение(explain(error));
      }
    })();
  }, []);

  if (!SYNC_ENABLED) {
    return <Line>Синхронизация в этой сборке не включена.</Line>;
  }

  // Страница собрана той же рамой, что вход (`auth-screen.tsx`): человек
  // приходит сюда из письма, то есть мимо приложения, и первое, что он
  // должен узнать, — что это то самое приложение.
  return (
    <AuthFrame icon={MailCheck} title="Подтверждение адреса">
      <div className="space-y-3 text-center">
        {состояние === "идёт" && <Line>Проверяем ссылку…</Line>}

        {состояние === "готово" && (
          <>
            <p className="text-sm text-ink">
              Адрес подтверждён. Больше ничего делать не нужно.
            </p>
            <Line>
              <Link href="/account" className="underline hover:no-underline">
                Вернуться к учётной записи
              </Link>
            </Line>
          </>
        )}

        {состояние === "отказ" && (
          <>
            <p role="alert" className="text-sm text-ink">
              {сообщение}
            </p>
            <Line>
              Ссылка действует сутки и срабатывает один раз. Если она устарела,
              войдите и запросите письмо заново на{" "}
              <Link href="/account" className="underline hover:no-underline">
                странице учётной записи
              </Link>
              .
            </Line>
          </>
        )}
      </div>
    </AuthFrame>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-muted">{children}</p>;
}
