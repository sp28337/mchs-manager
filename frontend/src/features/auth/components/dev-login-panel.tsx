"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { ErrorPanel } from "@/components/shared/error-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { listEmployees, listUnits } from "@/features/personnel/api";
import type { Employee, Unit } from "@/features/personnel/schemas";
import { ApiError } from "@/lib/api-client/client";
import { ROLE_LABELS, ROLES, type Role } from "@/lib/auth/session";

/**
 * Вход для разработки — виден только в dev-сборке.
 *
 * --- Почему выбирается РЕАЛЬНЫЙ сотрудник -------------------------------
 *
 * Можно было бы выдать выдуманный идентификатор, и вход бы состоялся. Но
 * половина экранов системы («мой табель», «мой баланс», «мои отпуска»,
 * «мои компенсации») строится вокруг `sub` токена, и с выдуманным
 * идентификатором все они показали бы пустоту. Человек, смотрящий систему
 * впервые, решил бы, что она ничего не умеет.
 *
 * Поэтому список тянется из `GET /personnel/employees`: выбранный
 * сотрудник существует, у него есть подразделение, табели и движения
 * баланса — ровно то, что засеял `make seed`.
 *
 * --- Почему все роли отмечены по умолчанию ------------------------------
 *
 * Меню и часть действий скрыты по ролям. Задача этого входа — дать
 * увидеть систему целиком, а не воспроизвести чьи-то полномочия; кому
 * нужно посмотреть глазами табельщика, снимет лишние отметки. Обратное
 * умолчание («ничего не отмечено») дало бы пустое меню и вопрос «а где
 * всё».
 */

const DEV_ONLY_ROLES: Role[] = [...ROLES];

export function DevLoginPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const employeeId = useId();
  const unitId = useId();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [chosen, setChosen] = useState("");
  const [scopeOverride, setScopeOverride] = useState("");
  const [roles, setRoles] = useState<Role[]>(DEV_ONLY_ROLES);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listEmployees({ pageSize: 200 }).then((envelope) => envelope.items),
      listUnits().catch((): Unit[] => []),
    ])
      .then(([people, allUnits]) => {
        if (cancelled) return;
        setEmployees(people);
        setUnits(allUnits);
        setChosen(people[0]?.id ?? "");
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError
            ? cause
            : new ApiError({
                type: "about:blank",
                title: "Бэкенд недоступен",
                status: 0,
                detail:
                  "Не удалось получить список сотрудников. Запущен ли бэкенд на "
                  + "127.0.0.1:8000 и выполнен ли `make seed`?",
              }),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const subject = employees.find((employee) => employee.id === chosen);
  // Область видимости — подразделение выбранного сотрудника, если её не
  // задали руками. Это то, что ожидает большинство экранов: командир
  // видит свою часть.
  const unitScope = scopeOverride || subject?.currentUnitId;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: chosen,
          fullName: subject?.fullName,
          roles,
          unitScope: unitScope ? [unitScope] : [],
        }),
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => null);
        throw new ApiError(
          problem ?? {
            type: "about:blank",
            title: "Вход не выполнен",
            status: response.status,
            detail: "Маршрут dev-login недоступен. В production-сборке его нет — это норма.",
          },
        );
      }
      router.replace(searchParams.get("from") ?? "/dashboard");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause
          : new ApiError({
              type: "about:blank",
              title: "Вход не выполнен",
              status: 0,
              detail: "Не удалось обратиться к маршруту входа для разработки.",
            }),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="dev-login"
      className="space-y-4 rounded-sm border-2 border-dashed border-signal bg-signal-soft/40 p-4"
    >
      <div className="space-y-1">
        <h2 id="dev-login" className="font-display text-sm font-bold uppercase tracking-wide text-signal">
          Вход для разработки
        </h2>
        <p className="max-w-prose text-xs text-ink-muted">
          Аутентификации в системе пока нет: <code className="font-mono">POST /auth/login</code>{" "}
          на бэкенде не реализован (фаза 12). Этот вход выдаёт{" "}
          <strong>неподписанный</strong> токен, существует только в dev-сборке и исчезнет
          вместе с появлением настоящего входа.
        </p>
      </div>

      {error ? <ErrorPanel error={error} /> : null}

      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor={employeeId}>Войти как</Label>
          <select
            id={employeeId}
            value={chosen}
            disabled={loading || employees.length === 0}
            onChange={(event) => setChosen(event.target.value)}
            className="block h-9 w-full rounded-xs border border-rule-strong bg-paper px-2 text-sm"
          >
            {loading ? <option>Загрузка списка…</option> : null}
            {!loading && employees.length === 0 ? (
              <option value="">Сотрудников нет — выполните `make seed`</option>
            ) : null}
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName} — {employee.rank}, № {employee.personnelNumber}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-muted">
            Экраны «мой табель», «мой баланс», «мои отпуска» покажут данные именно этого
            человека.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={unitId}>Область видимости</Label>
          <select
            id={unitId}
            value={scopeOverride}
            onChange={(event) => setScopeOverride(event.target.value)}
            className="block h-9 w-full rounded-xs border border-rule-strong bg-paper px-2 text-sm"
          >
            <option value="">Подразделение выбранного сотрудника</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name} ({unit.code})
              </option>
            ))}
          </select>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Роли
          </legend>
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {DEV_ONLY_ROLES.map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={roles.includes(role)}
                  onChange={(event) =>
                    setRoles((previous) =>
                      event.target.checked
                        ? [...previous, role]
                        : previous.filter((item) => item !== role),
                    )
                  }
                />
                {ROLE_LABELS[role]}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setRoles(DEV_ONLY_ROLES)}
            >
              Все
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRoles([])}>
              Снять все
            </Button>
          </div>
        </fieldset>

        <Button type="submit" variant="signal" className="w-full" disabled={pending || !chosen}>
          {pending ? "Вход…" : "Войти для разработки"}
        </Button>
      </form>
    </section>
  );
}
