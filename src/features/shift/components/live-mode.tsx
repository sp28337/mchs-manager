"use client";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils/cn";

import type { StoredProfile } from "../storage/profile";

/**
 * Режим «веду учёт».
 *
 * --- Зачем режим ----------------------------------------------------------
 *
 * Учётный период — полугодие или год, и его итог станет известен только в
 * конце. А человек ведёт учёт СЕЙЧАС: ему нужно знать, сколько
 * переработки набежало к сегодняшнему дню. Без такого режима расчёт до
 * декабря показывает норму, которую ещё не время было отрабатывать, и
 * «недоработку» в сотни часов — число верное по формуле и бессмысленное
 * по сути.
 *
 * --- Почему один компонент на два места ----------------------------------
 *
 * Тумблер нужен и в панели над сеткой (он меняет то, что в ней
 * нарисовано), и в настройках (человек, настраивающий профиль впервые,
 * ищет его там). Две копии разошлись бы подписью или пояснением, а хуже
 * подписи, обещающей не то, что делает переключатель, нет ничего.
 */

export function LiveModeSwitch({
  profile,
  onChange,
  spread,
  className,
}: {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  /** Подпись слева, дорожка справа — для строки настроек. */
  spread?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", spread && "w-full", className)}>
      <Switch
        checked={profile.liveMode}
        onChange={(liveMode) => onChange((previous) => ({ ...previous, liveMode }))}
        label="Онлайн"
        spread={spread}
      />
    </span>
  );
}
