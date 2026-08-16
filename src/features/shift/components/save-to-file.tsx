"use client";

import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";

import { exportProfile, type StoredProfile } from "../storage/profile";

/**
 * Выгрузка профиля прямо из шапки.
 *
 * Хранилище браузера — единственное место, где живут данные, и очистка
 * кэша стирает год внесённых отпусков. Такую кнопку нельзя держать только
 * в подвале, докуда нужно долистать двенадцать календарных сеток.
 *
 * Отдельным файлом, потому что шапку рабочего экрана рисует теперь сам
 * рабочий экран, а эта кнопка нужна ему и экрану вокруг.
 */
export function SaveToFile({ profile }: { profile: StoredProfile }) {
  return (
    <Button
      type="button"
      variant="outline"
      // Та же плашка, что у «В деньгах» и «Настроек» рядом: высота,
      // скругление и кегль совпадают до единицы.
      className="rounded-xl bg-paper-raised px-3 text-sm"
      size="sm"
      // Ниже `sm` от кнопки остаётся значок, и без имени она стала бы для
      // программы чтения безымянной.
      aria-label="Сохранить в файл"
      title="Сохранить в файл"
      onClick={() => {
        const blob = new Blob([exportProfile(profile)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `табель-${profile.accountingYear}-караул-${profile.guardNumber}.json`;
        link.click();
        URL.revokeObjectURL(url);
      }}
    >
      {/* Значок стоит всегда, подпись — с той же ширины, что у соседних
          кнопок шапки. Прежняя пара условий давала на 400–447 точках
          подпись без значка, а дальше и то и другое: три разных вида
          одной кнопки на трёх соседних ширинах. */}
      <Save aria-hidden className="size-4.5 shrink-0 text-ink-muted" />
      <span className="max-sm:hidden">Сохранить в файл</span>
    </Button>
  );
}
