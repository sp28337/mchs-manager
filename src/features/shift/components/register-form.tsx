"use client";

import { useState, type ReactNode } from "react";

import { LandingHero } from "@/components/landing/hero";
import { CtaIcon } from "@/components/landing/to-calculator";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";

import type { StoredProfile } from "../storage/profile";
import { CreateProfileModal } from "./create-profile-modal";

/**
 * Экран, когда сохранённый профиль не читается.
 *
 * --- Почему он остался, а обычная анкета — нет -----------------------------
 *
 * Пустое хранилище больше сюда не приводит: кнопка первого экрана
 * открывает окно прямо на главной, и переходить ради него на другой адрес
 * незачем. А вот испорченный профиль — случай другой: человек уже был с
 * профилем, пришёл к своему расчёту и вместо него получил объяснение.
 * Отправить его на главную значило бы потерять это объяснение вместе с
 * единственной кнопкой, которая спасает данные, — «скачать как есть».
 *
 * За окном — тот же первый экран, что и на главной: закрыв окно, человек
 * видит знакомую страницу, а не пустоту с адресом расчёта.
 */
export interface RegisterFormProps {
  onCreated: (profile: StoredProfile) => void;
  /** Сообщение о нечитаемом профиле. Место ему — в окне. */
  notice?: ReactNode;
}

export function RegisterForm({ onCreated, notice }: RegisterFormProps) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <main className="mx-auto w-full max-w-4xl px-6 pb-16 xl:max-w-6xl 2xl:max-w-7xl">
        <LandingHero
          cta={
            // Та же кнопка, что на посадочной: там она открывает окно на
            // месте, здесь — тоже. Форма и вес совпадают намеренно,
            // человек нажимает то же самое место.
            <Button
              type="button"
              size="lg"
              className="rounded-xl text-base font-bold"
              onClick={() => setOpen(true)}
            >
              <CtaIcon />
              Заполнить профиль
            </Button>
          }
        />
      </main>

      <CreateProfileModal
        open={open}
        onClose={() => setOpen(false)}
        onCreated={onCreated}
        notice={notice}
      />

      {/* Подвал той же формы, что на посадочной: линейка через всю
          ширину и переключатель темы у края. Без неё переключатель повисал
          пятном посреди пустого поля под первым экраном. */}
      <footer className="mt-8 border-t border-rule">
        <div className="mx-auto flex w-full max-w-4xl justify-center px-6 py-8 sm:justify-end xl:max-w-6xl 2xl:max-w-7xl">
          <ThemeToggle />
        </div>
      </footer>
    </>
  );
}
