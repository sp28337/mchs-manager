/** Формы ответов `personnel`, нужные другим модулям. */

export type EmploymentStatus = "active" | "on_leave" | "sick" | "dismissed";

export interface Employee {
  id: string;
  personnelNumber: string;
  fullName: string;
  rank: string;
  legalBase: "fps_service" | "labor_code";
  currentPositionId: string;
  currentUnitId: string;
  hiredAt: string;
  employmentStatus: EmploymentStatus;
}

export interface PageEnvelope<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}
