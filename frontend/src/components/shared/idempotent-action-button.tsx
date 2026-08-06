"use client";

import { useCallback, useRef, useState } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * FE016 — кнопка команды с ключом идемпотентности.
 *
 * DoD: «повторный клик во время pending-запроса ПЕРЕИСПОЛЬЗУЕТ
 * `Idempotency-Key`».
 *
 * --- Почему это существенно ---------------------------------------------
 *
 * Каждая команда этого API требует заголовка `Idempotency-Key`
 * (`openapi.yaml`), и смысл его один: отличить ПОВТОР от НОВОЙ ОПЕРАЦИИ.
 * Кнопка, генерирующая новый ключ на каждый клик, ломает ровно это —
 * второй клик по «Утвердить табель» становится вторым утверждением, а не
 * повтором первого.
 *
 * Отсюда устройство: ключ создаётся при НАЧАЛЕ операции и живёт до её
 * завершения. Успех очищает его — следующее нажатие есть новое намерение.
 * Отказ НЕ очищает: человек, нажавший «Повторить» после сетевого сбоя,
 * имеет в виду ту же операцию, и отправить её с новым ключом значило бы
 * рискнуть вторым начислением.
 *
 * --- Почему `disabled` мало ---------------------------------------------
 *
 * Заблокированная кнопка защищает от второго клика, но не от повтора
 * после ошибки, не от двойной отправки формы клавишей Enter и не от
 * восстановленного соединения, доставившего первый запрос дважды. Ключ
 * защищает от всего этого, а `disabled` остаётся лишь подсказкой глазу.
 */
export interface IdempotentActionButtonProps extends Omit<ButtonProps, "onClick"> {
  /** Действие принимает ключ и обязано передать его в команду. */
  action: (idempotencyKey: string) => Promise<unknown>;
  /** Подпись во время выполнения. */
  pendingLabel?: string;
}

export function IdempotentActionButton({
  action,
  pendingLabel,
  children,
  disabled,
  ...props
}: IdempotentActionButtonProps) {
  const [pending, setPending] = useState(false);
  // Ref, а не state: значение не влияет на разметку, и хранить его в
  // состоянии значило бы перерисовывать кнопку ради невидимой величины
  // (`rerender-use-ref-transient-values`).
  const keyRef = useRef<string | null>(null);

  const handleClick = useCallback(async () => {
    if (pending) return;

    // Ключ переживает отказ: «Повторить» означает ту же операцию.
    keyRef.current ??= crypto.randomUUID();

    setPending(true);
    try {
      await action(keyRef.current);
      // Успех завершает операцию — следующее нажатие есть новое намерение.
      keyRef.current = null;
    } finally {
      setPending(false);
    }
  }, [action, pending]);

  return (
    <Button
      {...props}
      onClick={handleClick}
      disabled={disabled || pending}
      aria-busy={pending}
    >
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}
