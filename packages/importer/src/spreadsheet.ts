import { unzipSync, strFromU8 } from "fflate";

/**
 * Minimal, dependency-light spreadsheet reader for product imports.
 *
 * Seller-center exports (Jumia, etc.) are valid .xlsx files but often use
 * unusual zip entry orders, inline strings or no sharedStrings part, which
 * trips general-purpose libraries. We only need cell values of the first
 * sheet, so we read the XML directly.
 */
export type Row = Record<string, string>;

export interface Sheet {
  headers: string[];
  /** One object per data row, keyed by header. Empty cells are omitted. `__row` is the 1-based sheet row. */
  rows: (Row & { __row: string })[];
}

export class SpreadsheetError extends Error {}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e]!,
  );
}

/** Concatenate every <t> run inside a fragment (handles rich text and phonetic runs). */
function textRuns(xml: string): string {
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  // ignore phonetic guide text (<rPh>) which is not part of the value
  const cleaned = xml.replace(/<rPh[\s\S]*?<\/rPh>/g, "");
  while ((m = re.exec(cleaned))) out += m[1] ?? "";
  return decodeXml(out);
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

function firstSheetPath(files: Record<string, Uint8Array>): string {
  const wb = files["xl/workbook.xml"];
  const rels = files["xl/_rels/workbook.xml.rels"];
  if (wb && rels) {
    const sheetTag = /<sheet\s[^>]*>/.exec(xmlText(wb))?.[0];
    const rid = sheetTag && (attr(sheetTag, "r:id") ?? /\s\w*:id="([^"]*)"/.exec(sheetTag)?.[1]);
    if (rid) {
      const relTag = new RegExp(`<Relationship\\s[^>]*Id="${rid}"[^>]*>`).exec(xmlText(rels))?.[0];
      const target = relTag && attr(relTag, "Target");
      if (target) {
        const p = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
        if (files[p]) return p;
      }
    }
  }
  const fallback = Object.keys(files).filter((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k)).sort()[0];
  if (!fallback) throw new SpreadsheetError("No worksheet found in the file");
  return fallback;
}

/** Some generators (e.g. .NET OpenXML SDK) prefix every element: <x:row>. Strip element prefixes. */
function xmlText(u: Uint8Array): string {
  return strFromU8(u).replace(/<(\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z_])/g, "<$1");
}

export function readXlsx(buf: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf, { filter: (f) => f.name.startsWith("xl/") && (f.name.endsWith(".xml") || f.name.endsWith(".rels")) });
  } catch {
    throw new SpreadsheetError("This is not a valid .xlsx file");
  }
  const shared: string[] = [];
  const ssXml = files["xl/sharedStrings.xml"];
  if (ssXml) {
    const re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
    let m: RegExpExecArray | null;
    const xml = xmlText(ssXml);
    while ((m = re.exec(xml))) shared.push(textRuns(m[1] ?? ""));
  }
  const sheetXml = xmlText(files[firstSheetPath(files)]!);
  const grid: string[][] = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  let rm: RegExpExecArray | null;
  let nextRow = 0;
  while ((rm = rowRe.exec(sheetXml))) {
    const rAttr = rm[1] ? attr(`<row${rm[1]}>`, "r") : undefined;
    const rowIdx = rAttr ? Number(rAttr) - 1 : nextRow;
    nextRow = rowIdx + 1;
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    let nextCol = 0;
    while ((cm = cellRe.exec(rm[2] ?? ""))) {
      const tag = `<c${cm[1]}>`;
      const ref = attr(tag, "r");
      const col = ref ? colIndex(ref) : nextCol;
      nextCol = col + 1;
      const inner = cm[2] ?? "";
      const type = attr(tag, "t");
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = "";
      if (type === "s") value = v !== undefined ? (shared[Number(v)] ?? "") : "";
      else if (type === "inlineStr") value = textRuns(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else value = v !== undefined ? decodeXml(v) : "";
      cells[col] = value;
    }
    grid[rowIdx] = Array.from(cells, (c) => c ?? "");
  }
  return Array.from(grid, (r) => r ?? []);
}

/** RFC 4180 CSV (also accepts ; separated files exported by some Excel locales). */
export function readCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function readSpreadsheet(buf: Uint8Array, fileName: string): Sheet {
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  let grid: string[][];
  if (isZip) grid = readXlsx(buf);
  else if (/\.(csv|txt)$/i.test(fileName)) grid = readCsv(new TextDecoder().decode(buf));
  else throw new SpreadsheetError("Upload an .xlsx or .csv file (old .xls files: open in Excel and 'Save As' .xlsx)");

  // Header = first row that has a recognisable name/SKU column (some exports have a title row first).
  const headerIdx = grid.findIndex((r) => r.some((c) => /^(name|sellersku|sku|parentsku|title)$/i.test(c.trim())));
  if (headerIdx < 0) throw new SpreadsheetError("Could not find a header row (expected columns like Name, SellerSKU, ParentSKU, Price)");
  const headers = grid[headerIdx]!.map((h) => h.trim());
  const rows: Sheet["rows"] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const obj: Row & { __row: string } = { __row: String(i + 1) };
    let any = false;
    headers.forEach((h, c) => {
      const v = (r[c] ?? "").trim();
      if (h && v) {
        obj[h] = v;
        any = true;
      }
    });
    if (any) rows.push(obj);
  }
  return { headers, rows };
}
