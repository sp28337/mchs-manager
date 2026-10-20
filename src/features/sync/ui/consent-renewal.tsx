"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

import { ConsentChecks } from "./consent-checks";
import { useLogout } from "./logout-dialog";
import { useSync } from "./sync-provider";

/**
 * «Документы обновились»: принять новую редакцию согласия или соглашения.
 *
 * Согласие относится к тому тексту, с которым человек соглашался: оно должно
 * быть конкретным и информированным (ч. 1 ст. 9 152-ФЗ), а новый текст он не
 * видел. Поэтому, когда сервер сообщает, что редакция согласия или соглашения
 * сменилась после принятия (`consent_pending`), на любой странице встаёт это
 * окно — так же, как окно о расхождении настроек (`conflict-dialog.tsx`).
 *
 * Выходов три, и «потом» среди них нет: пока ответа нет, синхронизация стоит
 * (`ждётСогласия` в провайдере). Принять — две те же отметки, что при
 * регистрации. Выйти — графики на устройстве при этом остаются у человека
 * (выход сперва отправляет всё на сервер). Отозвать согласие — это удалить
 * учётную запись (ч. 2 ст. 9), ссылка ведёт в «Мои данные».
 *
 * Политика, в отличие от них, ответа не требует: это сведения, которые
 * оператор обязан опубликовать (ч. 2 ст. 18.1), а не согласие, и её правка
 * человека ни о чём не спрашивает.
 */
export function ConsentRenewal() {
  const { account, actions, busy } = useSync();
  const logout = useLogout();
  const [termsAndPolicy, setTermsAndPolicy] = useState(false);
  const [personalData, setPersonalData] = useState(false);

  const pending = account?.consent_pending ?? [];
  if (account === null || pending.length === 0) return logout.dialog;

  const what =
    pending.length === 2
      ? "согласия на обработку персональных данных и пользовательского соглашения"
      : pending[0] === "consent"
        ? "согласия на обработку персональных данных"
        : "пользовательского соглашения";

  return (
    <>
      <Modal
        open
        onClose={() => undefined}
        title="Документы обновились"
        sheet
        closable={false}
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            Изменился текст {what}. Чтобы синхронизация продолжилась, прочитайте
            новую редакцию и подтвердите её. Пока вы не ответили, графики на
            этом устройстве работают как раньше, а на сервер ничего не
            отправляется.
          </p>

          <ConsentChecks
            termsAndPolicy={termsAndPolicy}
            personalData={personalData}
            onTermsAndPolicy={setTermsAndPolicy}
            onPersonalData={setPersonalData}
          />

          <div className="space-y-2">
            <Button
              disabled={busy || !termsAndPolicy || !personalData}
              onClick={() =>
                void actions
                  .acceptConsent({ termsAndPolicy, personalData })
                  .catch(() => undefined)
              }
            >
              Принять и продолжить
            </Button>
            <Button variant="outline" disabled={busy} onClick={logout.ask}>
              Выйти из аккаунта
            </Button>
          </div>

          <p className="text-xs text-ink-faint">
            Не согласны с новой редакцией — выйдите или{" "}
            <Link href="/account#data" className="underline hover:no-underline">
              удалите учётную запись
            </Link>
            : отзыв согласия означает удаление учётной записи. Записи в браузере
            при этом остаются у вас.
          </p>
        </div>
      </Modal>
      {logout.dialog}
    </>
  );
}
