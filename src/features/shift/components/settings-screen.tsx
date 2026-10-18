"use client";

import { CalendarClock, Palette, SlidersHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";

import { SectionLayout, type LayoutSection } from "@/components/ui/section-layout";

import type { StoredProfile } from "../storage/profile";
import { AppearanceSettings } from "./appearance-settings";
import { DangerActions, SettingsPanel } from "./settings-panel";

type SectionId = "schedule" | "display" | "appearance" | "delete";

const SECTIONS: readonly LayoutSection<SectionId>[] = [
  { id: "schedule", title: "График", icon: CalendarClock },
  { id: "display", title: "Показ расчёта", icon: SlidersHorizontal },
  { id: "appearance", title: "Оформление", icon: Palette },
  { id: "delete", title: "Удаление", icon: Trash2 },
];

/** Настройки графика: слева разделы, справа открытый, как на странице учётной записи. */
export function SettingsScreen({
  profile,
  onChange,
  onForget,
}: {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  onForget: () => void;
}) {
  const [section, setSection] = useState<SectionId>("schedule");

  return (
    <div className="mx-auto w-full max-w-4xl">
      <SectionLayout
        label="Разделы настроек"
        sections={SECTIONS}
        active={section}
        onSelect={setSection}
      >
        {section === "schedule" && (
          <SettingsPanel profile={profile} onChange={onChange} part="schedule" />
        )}
        {section === "display" && (
          <SettingsPanel profile={profile} onChange={onChange} part="display" />
        )}
        {section === "appearance" && <AppearanceSettings />}
        {section === "delete" && (
          <div className="space-y-4">
            <p className="text-xs leading-5 text-ink-muted">
              Удаление необратимо. Если график ещё может понадобиться, сначала
              сохраните его в файл — кнопка в меню.
            </p>
            <DangerActions onForget={onForget} onChange={onChange} showReset={false} start />
          </div>
        )}
      </SectionLayout>
    </div>
  );
}
