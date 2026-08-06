"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorPanel } from "@/components/shared/error-panel";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client/client";

import { recordElection } from "../api";
import {
  COMPENSATION_FORM_LABELS,
  HOUR_CATEGORY_LABELS,
  type CompensationForm,
  type CompensationLine,
} from "../schemas";

/**
 * FE028 — рапорт о выборе формы компенсации.
 *
 * DoD: «диалог показывается ТОЛЬКО если `electionAllowed = true`».
 *
 * --- Почему это не косметика --------------------------------------------
 *
 * Инвариант 7.1.3: выбор формы существует лишь там, где его даёт
 * действующая норма. Агрегат отвергает рапорт по категории без права
 * выбора, и предложить его на экране значило бы пообещать сотруднику то,
 * чего закон ему не даёт, — а потом показать 422.
 *
 * --- Денежная форма возникает ТОЛЬКО отсюда -----------------------------
 *
 * Приказ МЧС России № 410 п. 18: денежная компенсация выплачивается «по
 * просьбе сотрудника ВМЕСТО предоставления дополнительных дней отдыха».
 * Приказ МЧС России от 27.06.2024 № 539 п. 103 говорит то же со стороны
 * выплаты — «по рапорту сотрудника и на основании решения руководителя».
 *
 * Поэтому строка рождается отдыхом, и этот рапорт — единственный законный
 * способ сделать её денежной. Форма говорит об этом прямо: человек должен
 * понимать, что подаёт рапорт, а не переключает настройку.
 *
 * --- Почему не `<dialog>` -----------------------------------------------
 *
 * Выбор формы — не отвлечение от работы, а сама работа на этом экране.
 * Модальное окно пришлось бы открывать по каждой строке отдельно и
 * закрывать между ними; развёрнутая форма рядом со строкой позволяет
 * видеть все категории сразу и сравнить.
 */

export interface ElectionFormDialogProps {
  caseId: string;
  line: CompensationLine;
  token?: string | null;
  /** Дело финализировано — рапорт уже не принимается (инвариант 7.1.4). */
  locked: boolean;
}

export function ElectionFormDialog({
  caseId,
  line,
  token,
  locked,
}: ElectionFormDialogProps) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState<CompensationForm | null>(null);

  // DoD: без права выбора диалога нет вовсе — ни скрытого, ни
  // заблокированного. Но НАЗНАЧЕННАЯ форма названа и в этом случае:
  // «выбора нет» без ответа на вопрос «а что тогда будет» — половина
  // сообщения, и как раз та половина, которая человеку не нужна.
  if (!line.electionAllowed) {
    return (
      <div className="space-y-1">
        <AssignedForm form={line.compensationForm} />
        <p className="text-xs text-ink-muted">
          Форма определена нормой однозначно, выбор не предусмотрен.
        </p>
      </div>
    );
  }

  if (locked) {
    return (
      <div className="space-y-1">
        <AssignedForm form={line.compensationForm} />
        <p className="text-xs text-ink-muted">
          Начисление произведено — рапорт больше не принимается.
        </p>
      </div>
    );
  }

  async function elect(form: CompensationForm) {
    setError(null);
    setPending(form);
    try {
      await recordElection(
        caseId,
        { hourCategory: line.hourCategory, compensationForm: form },
        { token, idempotencyKey: crypto.randomUUID() },
      );
      toast.success(
        form === "monetary"
          ? "Рапорт о денежной компенсации принят"
          : "Выбрано дополнительное время отдыха",
      );
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause
          : new ApiError({
              type: "about:blank",
              title: "Сервер недоступен",
              status: 0,
              detail: "Не удалось подать рапорт. Проверьте соединение.",
            }),
      );
    } finally {
      setPending(null);
    }
  }

  const chosen = line.compensationForm;

  return (
    <div className="space-y-2">
      {error ? <ErrorPanel error={error} /> : null}

      <AssignedForm form={chosen} />

      <fieldset className="space-y-2">
        <legend className="sr-only">
          Форма компенсации по категории «{HOUR_CATEGORY_LABELS[line.hourCategory]}»
        </legend>

        <div className="flex flex-wrap gap-2">
          {(["additional_rest_time", "monetary"] as const).map((form) => (
            <Button
              key={form}
              type="button"
              size="sm"
              variant={chosen === form ? "default" : "outline"}
              aria-pressed={chosen === form}
              disabled={pending !== null || chosen === form}
              onClick={() => elect(form)}
            >
              {pending === form ? "Отправка…" : COMPENSATION_FORM_LABELS[form]}
            </Button>
          ))}
        </div>
      </fieldset>

      <p className="max-w-prose text-xs text-ink-muted">
        {chosen === "monetary"
          ? `Рапорт о денежной компенсации подан${line.employeeElectionAt ? ` ${new Date(line.employeeElectionAt).toLocaleDateString("ru-RU")}` : ""}.`
          : "По умолчанию предоставляется дополнительное время отдыха (Приказ № 410 п. 11). Денежная компенсация выплачивается вместо него по рапорту сотрудника (п. 18)."}
      </p>
    </div>
  );
}


/**
 * Назначенная форма компенсации — то, ради чего дело существует.
 *
 * Стоит на всех трёх путях (выбор доступен, выбора нет, дело
 * финализировано): человек, открывший карточку, первым делом спрашивает
 * «мне дадут отдых или деньги», и ответ не должен зависеть от того, есть
 * ли у него право выбора.
 */
function AssignedForm({ form }: { form: CompensationForm }) {
  return (
    <p className="text-sm">
      <span className="text-ink-muted">Форма компенсации: </span>
      <span className="font-medium">{COMPENSATION_FORM_LABELS[form]}</span>
    </p>
  );
}
