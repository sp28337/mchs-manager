"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorPanel } from "@/components/shared/error-panel";
import { ApiError } from "@/lib/api-client/client";
import { signIn } from "@/features/auth/api/sign-in";

/**
 * FE005 — форма входа.
 *
 * DoD: «форма валидирует пустые поля, вызывает мок-эндпоинт входа».
 *
 * --- О валидации --------------------------------------------------------
 *
 * Пустые поля проверяет браузер (`required`), а не JavaScript. Это не
 * экономия: нативная проверка работает до загрузки JS, объявляется
 * программам чтения с экрана без нашего участия и не расходится с тем,
 * что видит человек. Собственное сообщение появляется только там, где
 * браузеру сказать нечего, — на ответе сервера.
 *
 * --- О том, чего здесь нет ----------------------------------------------
 *
 * Настоящей аутентификации в системе пока нет: `FPS_JWT_PUBLIC_KEY`
 * объявлен в настройках бэкенда, но ни один эндпоинт токен не проверяет
 * (см. фазу 12 бэклога). Форма обращается к `/auth/login` и честно
 * показывает отказ, если его нет. Подменять это «входом без пароля» было
 * бы хуже неработающей формы: неработающая видна, а поддельная нет.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ApiError | null>(null);

  const loginId = useId();
  const passwordId = useId();

  const redirectTo = searchParams.get("from") ?? "/dashboard";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const login = String(form.get("login") ?? "");
    const password = String(form.get("password") ?? "");

    try {
      await signIn({ login, password });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : new ApiError({
        type: "about:blank",
        title: "Сервер недоступен",
        status: 0,
        detail: "Не удалось связаться с сервером. Проверьте соединение и повторите вход.",
      }));
      return;
    }

    startTransition(() => {
      router.replace(redirectTo);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate={false}>
      {error ? <ErrorPanel error={error} /> : null}

      <div className="space-y-1.5">
        <Label htmlFor={loginId}>Учётная запись</Label>
        <Input
          id={loginId}
          name="login"
          type="text"
          autoComplete="username"
          required
          autoFocus
          className="font-mono"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={passwordId}>Пароль</Label>
        <Input
          id={passwordId}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Вход…" : "Войти"}
      </Button>
    </form>
  );
}
