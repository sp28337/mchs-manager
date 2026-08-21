"use client";

import { exportProfile, type StoredProfile } from "../storage/profile";

/**
 * Выгрузка профиля в файл.
 *
 * Хранилище браузера — единственное место, где живут данные, и очистка
 * кэша стирает год внесённых отпусков. Такое действие нельзя держать
 * только в подвале, докуда нужно долистать двенадцать календарных сеток;
 * его место в шапке, рядом с настройками и расчётом.
 *
 * Здесь только само действие, без кнопки. Кнопок у него две — в шапке
 * (`HeaderTools`) и в подвале профиля, где о выгрузке сказано словами, —
 * и обе обязаны отдавать один и тот же файл с одним и тем же именем.
 */
export function saveProfileToFile(profile: StoredProfile): void {
  const blob = new Blob([exportProfile(profile)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `табель-${profile.accountingYear}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
