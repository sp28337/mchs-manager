"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, Field } from "@/components/ui/panel";

import { ApiClient } from "../api/client";
import { recoverClaim, recoverFinish, type RecoveryClaim } from "../session";
import { SYNC_ENABLED } from "./enabled";
import { explain } from "./messages";

/**
 * Новый пароль по ссылке из письма и ключу восстановления.
 *
 * Порядок (раздел 2.6 контракта): письмо подтверждает владение адресом,
 * сервер по ссылке отдаёт обёртку ключа восстановления, браузер
 * разворачивает ею ключ данных и упаковывает его новым паролем. Ключ
 * восстановления на сервер не уходит ни на одном шаге, и отдать обёртку
 * тому, кто читает почту, безопасно: без тех 26 знаков она бесполезна.
 *
 * Обёртка запрашивается сразу при открытии страницы, а не после ввода
 * ключа: так человек узнаёт, годится ли ссылка, до того как перепишет с
 * бумаги двадцать шесть знаков.
 */
export function RecoverScreen() {
  const client = useRef(new ApiClient());
  const запрошено = useRef(false);

  const [ссылка, setСсылка] = useState<RecoveryClaim | null>(null);
  const [токен, setТокен] = useState<string | null>(null);
  const [ошибка, setОшибка] = useState<string | null>(null);
  const [ключ, setКлюч] = useState("");
  const [пароль, setПароль] = useState("");
  const [идёт, setИдёт] = useState(false);
  const [готово, setГотово] = useState(false);

  const ключId = useId();
  const парольId = useId();

  useEffect(() => {
    if (!SYNC_ENABLED || запрошено.current) return;
    запрошено.current = true;

    // После отрисовки, а не во время неё: сперва страница, потом запрос.
    void (async () => {
      const token = new URLSearchParams(window.location.search).get("token");

      if (token === null || token.length < 16) {
        setОшибка("В ссылке нет кода. Откройте её из письма целиком.");
        return;
      }

      setТокен(token);

      try {
        setСсылка(await recoverClaim(client.current, token));
      } catch (error) {
        setОшибка(explain(error));
      }
    })();
  }, []);

  if (!SYNC_ENABLED) {
    return <p className="text-sm text-ink-muted">Синхронизация в этой сборке не включена.</p>;
  }

  if (готово) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-medium text-ink">Пароль заменён</h1>
        <p className="text-sm text-ink">
          Войдите с новым паролем. На остальных устройствах тоже придётся войти
          заново — так и должно быть, неизвестно, кто и почему терял доступ.
        </p>
        <p className="text-sm text-ink-muted">
          <Link href="/account" className="underline">
            Войти
          </Link>
        </p>
      </div>
    );
  }

  const нельзя = идёт || ссылка === null || токен === null || ключ.trim() === "" || пароль.length < 8;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (нельзя || ссылка === null || токен === null) return;

        setИдёт(true);
        setОшибка(null);

        void recoverFinish(client.current, {
          email: ссылка.email,
          token: токен,
          recoveryKey: ключ.trim(),
          newPassword: пароль,
          wrappedDekRec: ссылка.wrapped_dek_rec,
        })
          .then(() => setГотово(true))
          .catch((error: unknown) => setОшибка(explain(error)))
          .finally(() => setИдёт(false));
      }}
    >
      <h1 className="text-xl font-medium text-ink">Восстановление доступа</h1>

      {ссылка !== null && (
        <p className="text-sm text-ink-muted">
          Учётная запись <span className="text-ink">{ссылка.email}</span>.
          Понадобится ключ восстановления — те знаки, что вы записали при
          регистрации. Без него данные расшифровать невозможно: ключа от них у
          нас нет.
        </p>
      )}

      {ошибка !== null && (
        <p role="alert" className="text-sm text-ink">
          {ошибка}
        </p>
      )}

      <Card>
        <Field
          id={ключId}
          label="Ключ восстановления"
          stack
          note="Тире, пробелы и регистр не важны."
        >
          <Input
            id={ключId}
            value={ключ}
            autoComplete="off"
            spellCheck={false}
            placeholder="K7M2Q-9XJ4T-W1BR8-ZC6NY-H3VD5-PQ"
            onChange={(event) => setКлюч(event.target.value)}
          />
        </Field>
        <Field id={парольId} label="Новый пароль" stack note="Не меньше восьми знаков.">
          <Input
            id={парольId}
            type="password"
            autoComplete="new-password"
            value={пароль}
            onChange={(event) => setПароль(event.target.value)}
          />
        </Field>
      </Card>

      <Button type="submit" disabled={нельзя}>
        Задать новый пароль
      </Button>
    </form>
  );
}
