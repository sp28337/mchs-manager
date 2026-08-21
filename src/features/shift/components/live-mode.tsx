"use client";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils/cn";

import type { StoredProfile } from "../storage/profile";

/**
 * Режим «веду табель».
 *
 * --- Зачем режим ----------------------------------------------------------
 *
 * Учётный период — полугодие или год, и его итог станет известен только в
 * конце. А человек ведёт табель СЕЙЧАС: ему нужно знать, сколько
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
  className,
}: {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Switch
        checked={profile.liveMode}
        onChange={(liveMode) => onChange((previous) => ({ ...previous, liveMode }))}
        label="Онлайн"
      />
    </span>
  );
}
