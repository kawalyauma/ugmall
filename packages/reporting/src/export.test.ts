import { describe, expect, it } from "vitest";
import { toCSV, toPDF, toXLSX } from "./export";
import type { ReportResult } from "./types";

const report: ReportResult = {
  id: "sales",
  title: "Daily sales",
  subtitle: "2026-01-01 to 2026-01-02",
  columns: [
    { key: "period", label: "Date", type: "text" },
    { key: "revenue", label: "Revenue", type: "money" },
    { key: "note", label: "Note", type: "text" },
  ],
  rows: [
    { period: "2026-01-01", revenue: 116000, note: 'says "hi", ok' },
    { period: "2026-01-02", revenue: 5000, note: "=HYPERLINK(\"http://evil\")" },
  ],
  totals: { revenue: 121000 },
};

describe("exports", () => {
  it("writes CSV with escaping, totals and formula-injection guard", () => {
    const csv = toCSV(report);
    expect(csv).toContain('"says ""hi"", ok"');
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv.trim().split("\r\n").at(-1)).toBe("TOTAL,121000,");
  });
  it("writes XLSX and PDF", async () => {
    const x = await toXLSX(report, "UG Mall");
    expect(x.subarray(0, 2).toString()).toBe("PK");
    const p = await toPDF(report, "UG Mall");
    expect(p.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
