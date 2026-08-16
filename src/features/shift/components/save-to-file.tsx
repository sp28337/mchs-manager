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
      className="rounded-xl bg-paper-raised"
      size="sm"
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
      <div className="hidden xxs:block">Сохранить в файл</div>
      <div className="xxs:hidden xs:block">
        <Save className="size-5" />
      </div>
    </Button>
  );
}
