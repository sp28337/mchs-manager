"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { DocumentChanges } from "@/features/legal/changes-view";

import { LEGAL_URLS } from "../legal";
import { PersonalDataCheck } from "./consent-checks";
import { useLogout } from "./logout-dialog";
import { useSync } from "./sync-provider";

/**
 * «Документы обновились»: принять новую редакцию согласия на обработку.
 *
 * Согласие относится к тому тексту, с которым человек соглашался: оно должно
 * быть конкретным, предметным и информированным (ч. 1 ст. 9 152-ФЗ), а новый
 * текст он не видел. Поэтому, когда сервер сообщает, что редакция согласия
 * сменилась после принятия (`consent_pending`), на любой странице встаёт это
 * окно — так же, как окно о расхождении настроек (`conflict-dialog.tsx`).
 *
 * Спрашивается только согласие. Политика ответа не требует: это сведения,
 * которые оператор обязан опубликовать (ч. 2 ст. 18.1), а не согласие, и её
 * правка человека ни о чём не спрашивает. Соглашение меняется по порядку,
 * записанному в нём самом (раздел 11 `docs/legal/terms.md`). Почему согласие
 * всё же спрашивается — в `api/src/grafik_api/services/consents.py`.
 *
 * Выходов два, и «потом» среди них нет: пока ответа нет, синхронизация стоит
 * (`ждётСогласия` в провайдере). Принять — одна отметка. Выйти — как всегда:
 * графики уходят с устройства и вернутся при входе; отправить правки на сервер
 * без согласия нельзя, поэтому выход предупреждает о потере, только если такие
 * правки есть (`logout-dialog.tsx`). Не согласному остаётся отозвать согласие —
 * то есть удалить учётную запись (ч. 2 ст. 9): путь к этому в «Мои данные», в
 * самом окне о нём не напоминается.
 */
export function ConsentRenewal() {
  const { account, actions, busy } = useSync();
  const logout = useLogout();
  const [personalData, setPersonalData] = useState(false);
  const [showChanges, setShowChanges] = useState(false);

  const pending = account?.consent_pending ?? [];
  if (account === null || pending.length === 0) return logout.dialog;

  // С какой редакцией сравнивать: с той, что человек принимал последней.
  const accepted = account.consents.find((record) => record.kind === "consent")?.version;

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
            Изменился текст согласия на обработку персональных данных. Для
            продолжения ознакомьтесь с новой редакцией и подтвердите согласие.
          </p>

          {accepted !== undefined && (
            <div className="space-y-3">
              <button
                type="button"
                aria-expanded={showChanges}
                onClick={() => setShowChanges((was) => !was)}
                className="cursor-pointer text-sm text-ink underline decoration-ink-faint underline-offset-2 transition-colors hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                {showChanges ? "Скрыть изменения" : "Показать, что изменилось"}
              </button>

              {showChanges && (
                <div className="max-h-[40vh] overflow-y-auto overscroll-contain rounded-lg border border-rule p-3">
                  <DocumentChanges
                    id="consent"
                    from={accepted}
                    href={LEGAL_URLS.consent}
                  />
                </div>
              )}
            </div>
          )}

          <PersonalDataCheck
            checked={personalData}
            onChange={setPersonalData}
          />

          <div className="space-y-2">
            <Button
              disabled={busy || !personalData}
              onClick={() =>
                void actions.acceptConsent(personalData).catch(() => undefined)
              }
            >
              Принять и продолжить
            </Button>
            <Button variant="outline" disabled={busy} onClick={logout.ask}>
              Выйти из аккаунта
            </Button>
          </div>
        </div>
      </Modal>
      {logout.dialog}
    </>
  );
}
