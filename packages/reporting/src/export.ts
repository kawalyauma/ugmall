import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import type { ReportColumn, ReportResult } from "./types";

function fmt(value: string | number | null | undefined, col: ReportColumn): string {
  if (value === null || value === undefined) return "";
  switch (col.type) {
    case "money":
      return `UGX ${Math.round(Number(value)).toLocaleString("en-US")}`;
    case "number":
      return Number(value).toLocaleString("en-US");
    case "percent":
      return `${Number(value).toFixed(1)}%`;
    case "date":
      return String(value).slice(0, 10);
    default:
      return String(value);
  }
}

/** RFC 4180 CSV, with a guard against spreadsheet formula injection. */
export function toCSV(r: ReportResult): string {
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [r.columns.map((c) => esc(c.label)).join(",")];
  for (const row of r.rows) lines.push(r.columns.map((c) => esc(c.type === "date" && row[c.key] ? String(row[c.key]).slice(0, 10) : row[c.key])).join(","));
  if (r.totals) lines.push(r.columns.map((c, i) => esc(i === 0 ? "TOTAL" : (r.totals![c.key] ?? ""))).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export async function toXLSX(r: ReportResult, shopName = "Shop"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = shopName;
  wb.created = new Date();
  const ws = wb.addWorksheet(r.title.slice(0, 31));
  ws.addRow([`${shopName} — ${r.title}`]).font = { bold: true, size: 14 };
  ws.addRow([r.subtitle]).font = { italic: true, color: { argb: "FF666666" } };
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((cell) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } }));
  for (const row of r.rows) {
    ws.addRow(
      r.columns.map((c) => {
        const v = row[c.key];
        if (v === null || v === undefined) return null;
        if (c.type === "money" || c.type === "number" || c.type === "percent") return Number(v);
        if (c.type === "date") return new Date(String(v));
        return String(v);
      }),
    );
  }
  if (r.totals) {
    const t = ws.addRow(r.columns.map((c, i) => (i === 0 ? "TOTAL" : (r.totals![c.key] ?? null))));
    t.font = { bold: true };
  }
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(12, c.label.length + 4, c.type === "text" ? 28 : 14);
    if (c.type === "money") col.numFmt = '"UGX" #,##0';
    if (c.type === "number") col.numFmt = "#,##0";
    if (c.type === "percent") col.numFmt = '0.0"%"';
    if (c.type === "date") col.numFmt = "yyyy-mm-dd";
  });
  ws.views = [{ state: "frozen", ySplit: 4 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toPDF(r: ReportResult, shopName = "Shop"): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const landscape = r.columns.length > 5;
    const doc = new PDFDocument({ size: "A4", layout: landscape ? "landscape" : "portrait", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).font("Helvetica-Bold").text(`${shopName} — ${r.title}`);
    doc.fontSize(9).font("Helvetica").fillColor("#666").text(`${r.subtitle} · generated ${new Date().toLocaleString("en-GB", { timeZone: "Africa/Kampala" })}`);
    doc.moveDown().fillColor("#000");

    const width = doc.page.width - 72;
    const weights = r.columns.map((c) => (c.type === "text" ? 2 : 1));
    const totalW = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / totalW) * width);
    const rowH = 16;

    const drawRow = (cells: string[], opts: { bold?: boolean; fill?: string } = {}) => {
      if (doc.y + rowH > doc.page.height - 36) doc.addPage();
      const y = doc.y;
      if (opts.fill) doc.rect(36, y - 2, width, rowH).fill(opts.fill).fillColor(opts.fill === "#0f766e" ? "#fff" : "#000");
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
      let x = 36;
      cells.forEach((text, i) => {
        const numeric = r.columns[i]!.type !== "text" && r.columns[i]!.type !== "date";
        doc.text(text, x + 2, y + 2, { width: widths[i]! - 4, height: rowH, ellipsis: true, lineBreak: false, align: numeric ? "right" : "left" });
        x += widths[i]!;
      });
      doc.fillColor("#000");
      doc.x = 36;
      doc.y = y + rowH;
    };

    drawRow(r.columns.map((c) => c.label), { bold: true, fill: "#0f766e" });
    r.rows.forEach((row, idx) => drawRow(r.columns.map((c) => fmt(row[c.key], c)), { fill: idx % 2 ? "#f3f4f6" : undefined }));
    if (r.totals) drawRow(r.columns.map((c, i) => (i === 0 ? "TOTAL" : r.totals![c.key] !== undefined ? fmt(r.totals![c.key], c) : "")), { bold: true, fill: "#e5e7eb" });
    if (!r.rows.length) doc.moveDown().fontSize(10).text("No data for this period.");
    doc.end();
  });
}

export const formatCell = fmt;
