import type { Metadata } from "next";

import { RegisterForm } from "@/features/shift/components/register-form";

export const metadata: Metadata = {
  title: "Сверка табеля — суточное дежурство",
};

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl space-y-10 px-6 py-12">
      <header className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-widest text-ink-faint">
          Суммированный учёт служебного времени
        </p>
        <h1 className="text-3xl leading-tight">Сверьте свой табель</h1>
        <p className="max-w-prose text-ink-muted">
          Инструмент для пожарных, дежурящих сутки через трое, — аттестованных и
          вольнонаёмных. Строит ваш график караула на год, считает норму по
          производственному календарю и показывает, где выданный табель с ней
          расходится.
        </p>
      </header>

      <section
        aria-labelledby="why"
        className="space-y-2 rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3"
      >
        <h2 id="why" className="font-display text-sm font-bold uppercase tracking-wide">
          Самая частая ошибка в табеле
        </h2>
        <p className="max-w-prose text-sm">
          За смену, попавшую в отпуск или на больничный, ставят «минус 24 часа».
          Так делать нельзя. При суммированном учёте часы по графику,
          пришедшиеся на отсутствие с сохранением места службы,{" "}
          <strong>исключаются из нормы</strong>, а не вычитаются из факта
          (письмо Роструда от 01.03.2010 № 550-6-1). Иначе отпуск превращается
          в долг, которого нет.
        </p>
      </section>

      <section aria-labelledby="register" className="space-y-4">
        <h2 id="register" className="text-xl">
          Расскажите о себе
        </h2>
        <RegisterForm />
      </section>
    </main>
  );
}
