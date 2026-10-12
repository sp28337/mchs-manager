"use client";

import { Printer } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Ключ восстановления: показывается один раз.
 *
 * Это единственное, что вернёт доступ к данным, если пароль забыт: ключа
 * от них у оператора нет и быть не может (раздел 2.6 контракта). Поэтому
 * здесь не «сохраните на всякий случай», а прямое предупреждение, и
 * закрыть карточку можно только отметив, что ключ записан.
 *
 * --- Почему нельзя показать его потом -------------------------------------
 *
 * Потому что сервер его не хранит, а браузер не запоминает: на сервере
 * лежит только обёртка ключа данных, развернуть которую без этих 26
 * знаков невозможно. «Показать ещё раз» означало бы хранить ключ рядом с
 * данными — то есть отдать и то и другое любому, кто доберётся до
 * хранилища.
 */
export function RecoveryKeyCard({
  recoveryKey,
  onDone,
}: {
  recoveryKey: string;
  onDone: () => void;
}) {
  const [записал, setЗаписал] = useState(false);

  return (
    <div className="lit space-y-4 rounded-xl border border-signal/40 bg-paper-raised p-4">
      <div className="space-y-1">
        <h3 className="font-medium text-ink">Ключ восстановления</h3>
        <p className="text-sm text-ink-muted">
          Запишите его на бумагу и уберите туда, где храните документы. Это
          единственный способ вернуть доступ к данным, если пароль забудется:
          ключа от них нет ни у нас, ни у кого-либо ещё.
        </p>
      </div>

      <p className="select-all rounded-lg bg-paper-sunken px-3 py-2 text-center font-mono text-base tracking-wider text-ink">
        {recoveryKey}
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer aria-hidden /> Напечатать страницу
        </Button>
        <Button
          variant={записал ? "signal" : "outline"}
          onClick={() => (записал ? onDone() : setЗаписал(true))}
        >
          {записал ? "Да, ключ записан — скрыть" : "Я записал ключ"}
        </Button>
      </div>

      {записал && (
        <p className="text-xs text-ink-faint">
          После закрытия ключ больше не показывается. Если не успели —
          нажмите «Я записал ключ» ещё раз только когда он действительно
          будет у вас на бумаге.
        </p>
      )}
    </div>
  );
}
