import type { Metadata } from "next";
import { Suspense } from "react";

import { DevLoginPanel } from "@/features/auth/components/dev-login-panel";
import { LoginForm } from "@/features/auth/components/login-form";

export const metadata: Metadata = { title: "Вход — Учёт служебного времени ФПС ГПС" };

export default function LoginPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        {/* Надзаголовок несёт то, что человеку нужно знать до входа: в
            какую систему он входит. Это не декоративный «eyebrow». */}
        <p className="font-mono text-xs uppercase tracking-widest text-ink-faint">
          ФПС ГПС МЧС России
        </p>
        <h1 className="text-3xl leading-tight">Учёт служебного времени</h1>
        <p className="text-sm text-ink-muted">
          Вход по служебной учётной записи.
        </p>
      </header>

      <LoginForm />

      {/* Панель для разработки существует только в dev-сборке. Условие
          вычисляется на сервере при отрисовке, поэтому в production в
          разметку не попадает даже скрытой: её там просто нет. */}
      {process.env.NODE_ENV !== "production" ? (
        <Suspense fallback={null}>
          <DevLoginPanel />
        </Suspense>
      ) : null}
    </div>
  );
}
