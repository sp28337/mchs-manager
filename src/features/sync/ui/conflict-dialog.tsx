"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { importEntry } from "@/features/shift/storage/library";
import { storedProfileSchema } from "@/features/shift/storage/profile";

import { profileEnvelopeSchema } from "../engine/envelope";
import type { PendingRow } from "../store/vault";
import { useSync } from "./sync-provider";

/**
 * «На другом устройстве этот профиль настроен иначе».
 *
 * Окно встаёт там, где человек в этот миг находится: расхождение — это
 * вопрос о его данных, и откладывать его до того, как он сам зайдёт на
 * страницу аккаунта, значит синхронизировать всё, кроме спорного, и
 * молчать об этом.
 *
 * Три выхода — ровно те, что обещаны в разделе 5 контракта: оставить
 * своё, взять оттуда, сохранить обе копии. Четвёртого («решить потом»)
 * нет намеренно: пока расхождение не разобрано, этот профиль не
 * синхронизируется вовсе, и чем дольше так стоит, тем больше правок с
 * обеих сторон придётся сверять.
 */
export function SyncConflicts() {
  const { pending, actions, busy } = useSync();
  const [занят, setЗанят] = useState(false);
  const строка = pending[0];

  if (строка === undefined) return null;

  const свои = поля(строка, "local");
  const чужие = поля(строка, "remote");

  const решить = async (choice: "local" | "remote", сохранитьОбе = false) => {
    setЗанят(true);
    try {
      if (сохранитьОбе) сохранитьЧужую(строка);
      await actions.resolve(строка.itemId, choice);
    } finally {
      setЗанят(false);
    }
  };

  const нельзя = занят || busy;

  return (
    <Modal open onClose={() => undefined} title="График настроен по-разному" sheet>
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">
          График <span className="text-ink">«{строка.name}»</span> правили на двух
          устройствах, и настройки разошлись. Отмеченные дни, отпуска и заметки
          уже сведены — расходятся только ответы анкеты. Выберите, какие
          оставить.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Column заголовок="Это устройство" значения={свои} />
          <Column заголовок="Другое устройство" значения={чужие} />
        </div>

        <div className="space-y-2">
          <Button disabled={нельзя} onClick={() => void решить("local")}>
            Оставить настройки этого устройства
          </Button>
          <Button variant="outline" disabled={нельзя} onClick={() => void решить("remote")}>
            Взять настройки с другого устройства
          </Button>
          <Button
            variant="outline"
            disabled={нельзя}
            onClick={() => void решить("local", true)}
          >
            Сохранить обе копии
          </Button>
          <p className="text-xs text-ink-faint">
            «Обе копии» — здесь останутся ваши настройки, а вариант с другого
            устройства ляжет рядом отдельной записью «{строка.name} (с другого
            устройства)».
          </p>
        </div>
      </div>
    </Modal>
  );
}

function Column({
  заголовок,
  значения,
}: {
  заголовок: string;
  значения: { поле: string; значение: string }[];
}) {
  return (
    <div className="space-y-2 rounded-xl bg-paper-sunken p-3">
      <h4 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
        {заголовок}
      </h4>
      <dl className="space-y-1 text-sm">
        {значения.map(({ поле, значение }) => (
          <div key={поле} className="flex justify-between gap-3">
            <dt className="text-ink-muted">{ПОДПИСИ[поле] ?? поле}</dt>
            <dd className="text-right text-ink">{значение}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Подписи спорных полей — те же слова, что в настройках профиля. */
const ПОДПИСИ: Record<string, string> = {
  displayName: "Имя графика",
  workingConditions: "Условия труда",
  disabilityGroupIorII: "Инвалидность I–II группы",
  firstShiftDate: "Дата смены",
  countFrom: "Считать с",
  shiftStartTime: "Начало смены",
  schedulePattern: "График",
  customWorkDays: "Своих рабочих суток",
  customRestDays: "Своих выходных",
  shiftDurationHours: "Длительность смены",
  weeklyNormHours: "Норма в неделю",
  accountingYear: "Год учёта",
};

function поля(строка: PendingRow, сторона: "local" | "remote") {
  const разобрано = profileEnvelopeSchema.safeParse(
    сторона === "local" ? строка.local : строка.remote,
  );

  if (!разобрано.success) return [];

  const профиль = разобрано.data.body as Record<string, unknown>;

  return строка.fields.map((поле) => ({
    поле,
    значение: словами(профиль[поле]),
  }));
}

function словами(значение: unknown): string {
  if (значение === null || значение === undefined) return "не задано";
  if (typeof значение === "boolean") return значение ? "да" : "нет";
  if (значение === "normal") return "обычные";
  if (значение === "harmful_or_dangerous") return "вредные или опасные";

  return String(значение);
}

/**
 * Положить рядом вариант с другого устройства.
 *
 * Новой записью, а не поверх своей: «сохранить обе копии» для того и
 * существует, чтобы человек разобрался сам, глядя на оба графика, а не
 * выбирал вслепую по списку полей.
 */
function сохранитьЧужую(строка: PendingRow): void {
  const разобрано = profileEnvelopeSchema.safeParse(строка.remote);
  if (!разобрано.success) return;

  const профиль = storedProfileSchema.safeParse({
    ...разобрано.data.body,
    displayName: `${разобрано.data.body.displayName} (с другого устройства)`.slice(0, 200),
  });

  if (профиль.success) importEntry(профиль.data);
}
