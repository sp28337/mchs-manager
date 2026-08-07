import { getEmployeeHistory } from "@/features/compensation/api";
import type { CompensationCase } from "@/features/compensation/schemas";
import { getEmployeeGrants } from "@/features/leave/api";
import type { LeaveGrant } from "@/features/leave/schemas";
import { getEmployee, getServiceRecord, getUnit } from "@/features/personnel/api";
import type { Employee, ServiceRecordEntry, Unit } from "@/features/personnel/schemas";
import { getBalance, getMovements } from "@/features/rest-balance/api";
import type { BalanceMovement, RestBalance } from "@/features/rest-balance/schemas";
import { getTimesheetSummary } from "@/features/time-accounting/api/queries";
import type { HoursBreakdown } from "@/features/time-accounting/schemas";
import type { RequestOptions } from "@/lib/api-client/client";
import { ApiError } from "@/lib/api-client/client";

/**
 * FE045 — сбор трассы данных по сотруднику за период (UC-14).
 *
 * --- Почему трасса собирается здесь, а не приходит с сервера ------------
 *
 * Операции «выгрузка для служебной проверки» в `openapi.yaml` нет, и
 * реализованного модуля под неё тоже. Она нужна (СРС БП-7, UC-14), но
 * заводить её мимоходом ради одного экрана значило бы спроектировать
 * контракт выгрузки за один заход — а он должен быть частью документа,
 * а не следствием фронтенда.
 *
 * Всё, из чего трасса состоит, уже доступно на чтение: карточка,
 * история службы, сводка часов, дела о компенсации, движения баланса,
 * отпуска. Экран аудитора собирает их и НИЧЕГО не меняет — что и требует
 * DoD задачи: «все действия — GET».
 *
 * --- Частичный сбор не выдаётся за полный -------------------------------
 *
 * Каждый источник собирается независимо, и отказ одного не отменяет
 * остальных: аудитору полезны пять разделов из шести. Но отсутствующий
 * раздел ОТМЕЧАЕТСЯ как несобранный, а не показывается пустым — «данных
 * нет» и «получить не удалось» для проверки означают противоположное.
 */

/**
 * Раздел трассы в одном из ТРЁХ состояний, а не двух.
 *
 * Собран (`data`), не собран (`failure`) — и, отдельно, «данных нет, и
 * сервер сказал почему» (`absence`). Третье появилось не для полноты: за
 * март сводка часов отвечает 404 с пояснением «табель не утверждён», и
 * это не сбой доступа, а сам по себе результат проверки — существенный,
 * потому что неутверждённый табель за прошедший месяц есть нарушение
 * порядка, а не отсутствие сведений.
 *
 * Свалить его в `failure` значило бы поднять тревогу там, где сервер
 * ответил исчерпывающе; свалить в «пусто» — потерять причину.
 */
export interface TraceSection<T> {
  data: T | null;
  /** Почему раздел не собран (сбой). `null` — сбоя не было. */
  failure: string | null;
  /** Почему данных нет — со слов сервера. `null` — вопрос не возникал. */
  absence: string | null;
}

export interface EmployeeTrace {
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  collectedAt: string;
  employee: TraceSection<Employee>;
  unit: TraceSection<Unit>;
  serviceRecord: TraceSection<ServiceRecordEntry[]>;
  hours: TraceSection<HoursBreakdown>;
  compensation: TraceSection<CompensationCase[]>;
  balance: TraceSection<RestBalance>;
  movements: TraceSection<BalanceMovement[]>;
  leave: TraceSection<LeaveGrant[]>;
}

function describe(cause: unknown): string {
  if (cause instanceof ApiError) {
    const { title, detail } = cause.problem;
    return detail ? `${title} — ${detail}` : title;
  }
  return "не удалось получить данные";
}

async function section<T>(
  load: () => Promise<T>,
  emptyOn404?: () => T,
): Promise<TraceSection<T>> {
  try {
    return { data: await load(), failure: null, absence: null };
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) {
      // Раздел, у которого «ничего нет» выражается пустым списком,
      // получает пустой список. Остальные — объяснённое отсутствие: 404
      // с пояснением сервера есть ответ на вопрос, а не отказ отвечать.
      return emptyOn404
        ? { data: emptyOn404(), failure: null, absence: null }
        : { data: null, failure: null, absence: describe(cause) };
    }
    return {
      data: null,
      failure: `${cause instanceof ApiError ? cause.status : "—"}: ${describe(cause)}`,
      absence: null,
    };
  }
}

export async function collectEmployeeTrace(
  employeeId: string,
  period: { periodStart: string; periodEnd: string },
  options: RequestOptions,
): Promise<EmployeeTrace> {
  // Разделы независимы, поэтому собираются параллельно: последовательный
  // сбор шести источников превратил бы открытие страницы в ожидание,
  // равное сумме задержек, без всякой на то причины.
  const [employee, serviceRecord, hours, compensation, balance, movements, leave] =
    await Promise.all([
      section(() => getEmployee(employeeId, options)),
      section(() => getServiceRecord(employeeId, options), () => []),
      section(() => getTimesheetSummary(employeeId, period, options)),
      section(() => getEmployeeHistory(employeeId, { pageSize: 100 }, options), () => []),
      section(() => getBalance(employeeId, undefined, options)),
      section(() => getMovements(employeeId, { pageSize: 200 }, options), () => []),
      section(() => getEmployeeGrants(employeeId, options), () => []),
    ]);

  const unit: TraceSection<Unit> = employee.data
    ? await section(() => getUnit(employee.data!.currentUnitId, options))
    : {
        data: null,
        failure: "подразделение не запрашивалось: карточка сотрудника не получена",
        absence: null,
      };

  return {
    employeeId,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    collectedAt: new Date().toISOString(),
    employee,
    unit,
    serviceRecord,
    hours,
    compensation,
    balance,
    movements,
    leave,
  };
}

/**
 * Отбор по периоду делается ЗДЕСЬ, а не запросом.
 *
 * Часть эндпоинтов периода не принимает — движения баланса и отпуска
 * отдаются целиком. Показать их полностью на экране «за март» значило бы
 * ответить не на заданный вопрос; отбросить молча — скрыть, что данные
 * за пределами периода существуют. Поэтому отбор виден: рядом со списком
 * стоит, сколько записей осталось за границами.
 */
export function withinPeriod(
  isoDate: string | null | undefined,
  periodStart: string,
  periodEnd: string,
): boolean {
  if (!isoDate) return false;
  const day = isoDate.slice(0, 10);
  return day >= periodStart && day < periodEnd;
}
