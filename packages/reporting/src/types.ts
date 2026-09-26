export type ColumnType = "text" | "number" | "money" | "percent" | "date";

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

export interface ReportResult {
  id: string;
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, number>;
}

export interface ReportParams {
  from: string; // YYYY-MM-DD (Kampala time)
  to: string; // YYYY-MM-DD inclusive
  granularity?: "day" | "week" | "month";
}

export const TZ = "Africa/Kampala";
