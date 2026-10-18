"use client";

import { LogOut, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

import { useSync } from "./sync-provider";

/**
 * Выход из учётной записи с вопросом.
 *
 * --- Почему вопрос --------------------------------------------------------
 *
 * Выход уносит с устройства все графики (`forgetEverything`): они хранятся в
 * учётной записи и вернутся при входе. Прежде они оставались, и выходило так:
 * человек выходит, стирает открытый график, заводит новый — и в проводнике
 * тут же «появляются» несколько старых, потому что стёрт был один из многих.
 * Раз выход теперь что-то делает с данными на экране, он говорит об этом
 * заранее, а не после.
 *
 * --- Второй вопрос: не всё доехало ----------------------------------------
 *
 * Прежде чем стереть, приложение отправляет на сервер всё, что ещё не
 * уехало. Не вышло (нет сети, сервер отказал, остался вопрос о расхождении
 * настроек) — выход останавливается и спрашивает во второй раз: уйти
 * всё равно значит потерять эти правки. Дорога к сохранению в файл рядом.
 *
 * --- Куда человек попадает после выхода ----------------------------------
 *
 * Со страницы учётной записи — никуда: форма входа сменяет страницу на месте.
 * Откуда угодно ещё — на главную: расчёт, открытый в этой вкладке, держит
 * график в памяти, и первая же правка записала бы его обратно в только что
 * очищенное хранилище. Страница расчёта при уходе размонтируется целиком, и
 * держать ей уже нечего.
 */
export function useLogout(): { ask: () => void; dialog: ReactNode } {
  const { actions, busy } = useSync();
  const path = usePathname();
  const router = useRouter();
  const [step, setStep] = useState<"closed" | "ask" | "unsynced">("closed");

  const leave = async (force: boolean) => {
    // Причина отказа уже показана человеку строкой ошибки провайдера
    // (`действие`), здесь она нужна только следу в консоли.
    const result = await actions.logout({ force }).catch((error: unknown) => {
      console.warn("выход не удался", error);
      return "failed" as const;
    });

    if (result === "unsynced") {
      setStep("unsynced");
      return;
    }
    if (result === "failed") return;

    if (path.startsWith("/account")) router.refresh();
    else router.push("/");
  };

  // Каждое окно закрывает только само себя. Родное событие `close` у
  // первого окна приходит уже после ухода (`Modal` доигрывает его перед
  // закрытием), то есть тогда, когда второе давно открыто: общий «закрыть всё»
  // гасил бы и его, и предупреждение о непереданных правках пропадало бы, если
  // сервер ответил быстрее ухода первого окна.
  const closeIf = (which: "ask" | "unsynced") => () =>
    setStep((was) => (was === which ? "closed" : was));

  const dialog = (
    <>
      <ConfirmDialog
        open={step === "ask"}
        onClose={closeIf("ask")}
        onConfirm={() => void leave(false)}
        title="Выйти из учётной записи?"
        confirm="Выйти"
        icon={<LogOut aria-hidden />}
      >
        <p>
          Графики уберутся с этого устройства: они хранятся в вашей учётной записи и
          вернутся, когда вы войдёте снова.
        </p>
        <p className="text-ink-muted">
          Перед выходом приложение отправит на сервер всё, что ещё не успело уехать.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={step === "unsynced"}
        onClose={closeIf("unsynced")}
        onConfirm={() => void leave(true)}
        title="Не всё ушло на сервер"
        confirm="Выйти и потерять правки"
        icon={<TriangleAlert aria-hidden />}
        destructive
      >
        <p>
          Часть правок отправить не удалось: нет связи с сервером или остался вопрос о расхождении
          настроек. Если выйти сейчас, они пропадут вместе с графиками на этом устройстве.
        </p>
        <p className="text-ink-muted">
          Сохраните график в файл —{" "}
          <Link
            href="/calculator#save"
            onClick={closeIf("unsynced")}
            className="text-ink underline hover:no-underline"
          >
            открыть окно сохранения
          </Link>{" "}
          — или попробуйте выйти позже.
        </p>
      </ConfirmDialog>
    </>
  );

  return { ask: () => (busy ? undefined : setStep("ask")), dialog };
}
