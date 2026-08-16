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
 * Здесь осталось только само действие, без кнопки: кнопку рисует
 * `HeaderTools` — на широком экране плашкой в ряду, на узком строкой в
 * меню. Две кнопки для одного действия означали бы два разных вида у
 * одной вещи.
 */
export function saveProfileToFile(profile: StoredProfile): void {
  const blob = new Blob([exportProfile(profile)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `табель-${profile.accountingYear}-караул-${profile.guardNumber}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
