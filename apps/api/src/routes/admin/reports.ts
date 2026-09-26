import { Hono } from "hono";
import { z } from "zod";

import { expenses } from "@ugmall/database";
import { dashboardSummary, REPORTS, runReport, toCSV, toPDF, toXLSX, TZ } from "@ugmall/reporting";
import { PERMISSIONS } from "@ugmall/shared";
import { ApiError } from "../../lib/http";
import { crudRoutes } from "../../lib/crud";
import { getSettings } from "../../lib/settings";
import { requirePermission } from "../../middleware/auth";
import type { AppEnv } from "../../types";

export const adminReportRoutes = new Hono<AppEnv>();
const P = PERMISSIONS;

adminReportRoutes.get("/dashboard", requirePermission(P.dashboard), async (c) => {
  const summary = await dashboardSummary(c.get("container").db, c.req.query("date"));
  const staff = c.get("staff");
  // hide money from roles without report access
  if (!staff.permissions.includes("*") && !staff.permissions.includes(P.reportsView)) {
    return c.json({ ...summary, revenue: null, cost: null, grossProfit: null, codWithRiders: null, last7Days: summary.last7Days.map((d) => ({ ...d, revenue: null })) });
  }
  return c.json(summary);
});

adminReportRoutes.get("/reports", requirePermission(P.reportsView), (c) =>
  c.json(Object.entries(REPORTS).map(([id, r]) => ({ id, title: r.title, needsRange: r.needsRange, granularity: !!r.granularity }))),
);

adminReportRoutes.get("/reports/:id", requirePermission(P.reportsView), async (c) => {
  const { db } = c.get("container");
  const id = c.req.param("id");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const monthStart = `${today.slice(0, 8)}01`;
  const g = c.req.query("granularity");
  let report;
  try {
    report = await runReport(db, id, {
      from: c.req.query("from") || monthStart,
      to: c.req.query("to") || today,
      granularity: g === "week" || g === "month" || g === "day" ? g : undefined,
    });
  } catch (err) {
    throw new ApiError(422, (err as Error).message);
  }
  const format = c.req.query("format") ?? "json";
  const shopName = (await getSettings(db)).shopName;
  const fileBase = `${report.id}_${c.req.query("from") ?? monthStart}_${c.req.query("to") ?? today}`;
  if (format === "csv") {
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${fileBase}.csv"`);
    return c.body(toCSV(report));
  }
  if (format === "xlsx") {
    c.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    c.header("Content-Disposition", `attachment; filename="${fileBase}.xlsx"`);
    return c.body(new Uint8Array(await toXLSX(report, shopName)));
  }
  if (format === "pdf") {
    c.header("Content-Type", "application/pdf");
    c.header("Content-Disposition", `${c.req.query("inline") ? "inline" : "attachment"}; filename="${fileBase}.pdf"`);
    return c.body(new Uint8Array(await toPDF(report, shopName)));
  }
  return c.json(report);
});

adminReportRoutes.route(
  "/expenses",
  crudRoutes({
    table: expenses,
    schema: z.object({
      category: z.string().trim().min(2).max(60),
      description: z.string().max(500).nullable().optional(),
      amount: z.number().int().min(1),
      spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
    entity: "expense",
    permission: P.expensesManage,
    searchColumns: [expenses.category, expenses.description],
    orderBy: expenses.spentOn,
    prepare: (i, isCreate) => (isCreate ? { ...i } : i),
  }),
);

