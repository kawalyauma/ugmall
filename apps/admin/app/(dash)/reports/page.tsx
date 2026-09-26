"use client";

import { useState } from "react";
import { Download, Printer } from "lucide-react";
import { qs } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Card, PageHeader, Table } from "@/components/ui/kit";

interface ReportDef { id: string; title: string; needsRange: boolean; granularity: boolean }
interface Report {
  title: string;
  subtitle: string;
  columns: { key: string; label: string; type: string }[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, number>;
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Kampala" });

function fmt(v: string | number | null | undefined, type: string) {
  if (v === null || v === undefined) return "";
  if (type === "money") return `UGX ${Math.round(Number(v)).toLocaleString("en-US")}`;
  if (type === "number") return Number(v).toLocaleString("en-US");
  if (type === "percent") return `${Number(v).toFixed(1)}%`;
  if (type === "date") return String(v).slice(0, 10);
  return String(v);
}

export default function Reports() {
  const { data: defs } = useApi<ReportDef[]>("/admin/reports");
  const [id, setId] = useState("sales");
  const [from, setFrom] = useState(`${today().slice(0, 8)}01`);
  const [to, setTo] = useState(today());
  const [granularity, setGranularity] = useState("day");
  const def = defs?.find((d) => d.id === id);
  const query = qs({ from, to, granularity: def?.granularity ? granularity : undefined });
  const { data: report, loading } = useApi<Report>(`/admin/reports/${id}${query}`);
  const presets: [string, () => [string, string]][] = [
    ["Today", () => [today(), today()]],
    ["Last 7 days", () => [new Date(Date.now() - 6 * 864e5).toLocaleDateString("en-CA"), today()]],
    ["This month", () => [`${today().slice(0, 8)}01`, today()]],
    ["This year", () => [`${today().slice(0, 4)}-01-01`, today()]],
  ];

  return (
    <>
      <PageHeader
        title="Reports"
        actions={
          <>
            {(["csv", "xlsx", "pdf"] as const).map((f) => (
              <a key={f} href={`/api/admin/reports/${id}${query}${query ? "&" : "?"}format=${f}`}>
                <Button size="sm" variant="secondary"><Download className="size-4" /> {f.toUpperCase()}</Button>
              </a>
            ))}
            <Button size="sm" variant="secondary" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
          </>
        }
      />
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <Select className="h-10 max-w-72" value={id} onChange={(e) => setId(e.target.value)}>
          {defs?.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </Select>
        {def?.needsRange !== false && (
          <>
            <Input type="date" className="h-10 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" className="h-10 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
            {presets.map(([l, f]) => (
              <Button key={l} size="sm" variant="ghost" onClick={() => { const [a, b] = f(); setFrom(a); setTo(b); }}>{l}</Button>
            ))}
          </>
        )}
        {def?.granularity && (
          <Select className="h-10 w-32" value={granularity} onChange={(e) => setGranularity(e.target.value)}>
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </Select>
        )}
      </div>
      {report && (
        <Card title={<span>{report.title} <span className="text-sm font-normal text-gray-500">· {report.subtitle}</span></span>}>
          {loading && <p className="text-xs text-gray-400">Refreshing…</p>}
          <Table
            rows={[...report.rows, ...(report.totals ? [{ __total: 1, ...report.totals } as Record<string, string | number | null>] : [])]}
            columns={report.columns.map((c, i) => ({
              header: c.label,
              className: c.type === "text" || c.type === "date" ? "" : "text-right whitespace-nowrap",
              cell: (r: Record<string, string | number | null>) =>
                r.__total ? <b>{i === 0 ? "TOTAL" : fmt(r[c.key], c.type)}</b> : fmt(r[c.key], c.type),
            }))}
          />
        </Card>
      )}
    </>
  );
}
