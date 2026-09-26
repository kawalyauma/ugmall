"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/input";
import { Badge, Card, PageHeader, Stat, StatusBadge, Table, dt, money } from "@/components/ui/kit";

interface Issue { row: number | null; sku?: string; level: "error" | "warning"; message: string }
interface Outcome { sku: string; name: string; action: "create" | "update" | "skip"; productId?: string; variantsNew: number; variantsExisting: number; variantsNotInFile: number; category: string | null; price: number; stock: number }
interface Summary {
  brands: { new: number; existing: number; names: string[] };
  categories: { new: number; existing: number; paths: string[] };
  products: { new: number; existing: number; skipped: number };
  variants: { new: number; existing: number; notInFile: number; deactivated: number };
  stockUnits: number;
  images: number;
  outcomes: Outcome[];
  issues: Issue[];
}
interface Preview { importId: string; fileName: string; format: string; stats: { rows: number; products: number; variants: number; skippedRows: number }; summary: Summary }
interface History {
  imports: { id: string; fileName: string; format: string; status: string; createdAt: string; staffName: string | null; summary: { products?: Summary["products"]; variants?: Summary["variants"]; error?: string } | null }[];
  imageQueue: Record<string, number>;
}

const DEFAULTS = { stockMode: "set", status: "active", updateExisting: true, stripCommonRoot: true, deactivateMissing: false, downloadImages: true };

export default function ImportProducts() {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [opts, setOpts] = useState(DEFAULTS);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<{ summary: Summary; imageJobs: number } | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [filter, setFilter] = useState<"all" | "create" | "update">("all");
  const { data: history, reload } = useApi<History>("/admin/imports");

  async function runPreview() {
    if (!file) return;
    setBusy("preview");
    setResult(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("options", JSON.stringify(opts));
      const res = await fetch("/api/admin/imports/preview", { method: "POST", body: fd, credentials: "include", headers: { "X-Requested-With": "ugmall" } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setPreview(data);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!preview) return;
    setBusy("apply");
    try {
      const res = await fetch(`/api/admin/imports/${preview.importId}/apply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-With": "ugmall" },
        body: JSON.stringify(opts),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setResult(data);
      setPreview(null);
      setFile(null);
      toast("Import complete");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const s = result?.summary ?? preview?.summary;
  const outcomes = (s?.outcomes ?? []).filter((o) => filter === "all" || o.action === filter);
  const errors = s?.issues.filter((i) => i.level === "error").length ?? 0;

  return (
    <>
      <PageHeader
        title="Import products"
        subtitle="Upload a Jumia / Kilimall seller-center sheet or a simple spreadsheet. Rows that share a ParentSKU become ONE product with sizes as variants."
        actions={
          <>
            <a href="/api/admin/imports/template.csv"><Button size="sm" variant="secondary"><Download className="size-4" /> Simple template</Button></a>
            <Link href="/products"><Button size="sm" variant="ghost">Back to products</Button></Link>
          </>
        }
      />

      {!result && (
        <Card title="1. Choose file and options">
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center hover:border-brand-600">
              <FileSpreadsheet className="size-10 text-brand-700" />
              <span className="font-medium">{file ? file.name : "Select .xlsx or .csv"}</span>
              <span className="text-xs text-gray-500">{file ? `${(file.size / 1024).toFixed(0)} KB` : "Max 20 MB"}</span>
              <input type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Stock for existing sizes" hint={opts.stockMode === "set" ? "Stock count: on-hand becomes the sheet value" : opts.stockMode === "add" ? "Adds the sheet quantity as newly received stock" : "Only new sizes get stock"}>
                <Select value={opts.stockMode} onChange={(e) => setOpts({ ...opts, stockMode: e.target.value })}>
                  <option value="set">Set to sheet quantity</option>
                  <option value="add">Add sheet quantity</option>
                  <option value="ignore">Don't change</option>
                </Select>
              </Field>
              <Field label="New products are">
                <Select value={opts.status} onChange={(e) => setOpts({ ...opts, status: e.target.value })}>
                  <option value="active">Live on the shop</option>
                  <option value="draft">Draft (review first)</option>
                </Select>
              </Field>
              {([
                ["updateExisting", "Update products that already exist (matched by SKU)"],
                ["stripCommonRoot", "Drop the shared top category (e.g. “Fashion”) so the menu starts at Men's / Women's"],
                ["deactivateMissing", "Hide sizes of these products that are not in this file"],
                ["downloadImages", "Download product images to this server"],
              ] as const).map(([k, label]) => (
                <label key={k} className="flex items-start gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={runPreview} loading={busy === "preview"} disabled={!file}>
              <Upload className="size-4" /> Preview import
            </Button>
            <span className="self-center text-xs text-gray-500">Nothing is changed until you confirm.</span>
          </div>
        </Card>
      )}

      {s && (
        <div className="mt-4 space-y-4">
          {result ? (
            <div className="flex items-center gap-2 rounded-2xl bg-green-50 p-4 text-green-800">
              <CheckCircle2 className="size-5" /> Import finished. {result.imageJobs ? `Images for ${result.imageJobs} products are downloading in the background.` : ""}
            </div>
          ) : (
            <Card title={`2. Review — ${preview?.fileName} (${preview?.format === "jumia" ? "Jumia seller-center format" : "spreadsheet"})`}>
              <p className="text-sm text-gray-600">
                {preview?.stats.rows} rows → <b>{preview?.stats.products} products</b> with <b>{preview?.stats.variants} size/colour variants</b>
                {preview?.stats.skippedRows ? `, ${preview.stats.skippedRows} rows skipped` : ""}.
              </p>
            </Card>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Stat label="New products" value={s.products.new} tone="green" />
            <Stat label="Updated products" value={s.products.existing} />
            <Stat label="New variants" value={s.variants.new} tone="green" />
            <Stat label="Updated variants" value={s.variants.existing} />
            <Stat label="New categories" value={s.categories.new} />
            <Stat label="New brands" value={s.brands.new} />
          </div>
          {s.variants.notInFile > 0 && (
            <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              {s.variants.notInFile} sizes already on the shop are not in this file —{" "}
              {s.variants.deactivated ? `${s.variants.deactivated} were hidden.` : opts.deactivateMissing ? "they will be hidden." : "they will be kept (tick “Hide sizes … not in this file” to hide them)."}
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {(s.categories.paths.length > 0 || s.brands.names.length > 0) && (
              <Card title="New brands & categories">
                {s.brands.names.length > 0 && <p className="mb-2 text-sm">Brands: {s.brands.names.map((b) => <Badge key={b} tone="brand">{b}</Badge>)}</p>}
                <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                  {s.categories.paths.map((p) => <li key={p}>+ {p}</li>)}
                </ul>
              </Card>
            )}
            {s.issues.length > 0 && (
              <Card title={`Problems (${errors} errors, ${s.issues.length - errors} warnings)`}>
                <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                  {s.issues.slice(0, 300).map((i, k) => (
                    <li key={k} className={i.level === "error" ? "text-red-700" : "text-amber-700"}>
                      Row {i.row ?? "–"} {i.sku && <code className="text-xs">{i.sku}</code>}: {i.message}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
          <Card
            title="Products"
            actions={
              <Select className="h-9 w-40 text-sm" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                <option value="all">All ({s.outcomes.length})</option>
                <option value="create">New</option>
                <option value="update">Updated</option>
              </Select>
            }
          >
            <Table
              rows={outcomes.slice(0, 500)}
              columns={[
                { header: "SKU", cell: (o) => <code className="text-xs">{o.sku}</code> },
                { header: "Product", cell: (o) => (o.productId && result ? <Link className="text-brand-700" href={`/products/${o.productId}`}>{o.name}</Link> : o.name) },
                { header: "Category", cell: (o) => <span className="text-xs text-gray-500">{o.category ?? "—"}</span> },
                { header: "Price", cell: (o) => money(o.price), className: "text-right whitespace-nowrap" },
                { header: "Sizes", cell: (o) => `${o.variantsNew + o.variantsExisting}${o.variantsNew && o.variantsExisting ? ` (${o.variantsNew} new)` : ""}` },
                { header: "Stock", cell: (o) => o.stock, className: "text-right" },
                { header: "", cell: (o) => <Badge tone={o.action === "create" ? "green" : o.action === "update" ? "blue" : "gray"}>{o.action === "create" ? "new" : o.action}</Badge> },
              ]}
            />
          </Card>
          {preview && (
            <div className="sticky bottom-4 flex justify-end gap-2 rounded-2xl bg-white/90 p-3 shadow-lg backdrop-blur">
              <Button variant="secondary" onClick={() => setPreview(null)}>Cancel</Button>
              <Button onClick={apply} loading={busy === "apply"} disabled={errors > 0 && s.products.new + s.products.existing === 0}>
                Import {s.products.new + s.products.existing} products · {s.variants.new + s.variants.existing} variants
              </Button>
            </div>
          )}
          {result && <Button variant="secondary" onClick={() => setResult(null)}>Import another file</Button>}
        </div>
      )}

      <Card title="Import history" className="mt-6">
        {history && (history.imageQueue.waiting || history.imageQueue.active || history.imageQueue.delayed || history.imageQueue.failed) ? (
          <p className="mb-3 text-sm text-gray-600">
            Image downloads: {history.imageQueue.active} running, {history.imageQueue.waiting + history.imageQueue.delayed} waiting, {history.imageQueue.completed} done
            {history.imageQueue.failed ? <span className="text-red-600"> · {history.imageQueue.failed} failed (check the server can reach the image URLs)</span> : null}{" "}
            <button className="text-brand-700 underline" onClick={() => reload()}>refresh</button>
          </p>
        ) : null}
        <Table
          rows={history?.imports ?? []}
          columns={[
            { header: "When", cell: (i) => dt(i.createdAt) },
            { header: "File", cell: (i) => i.fileName },
            { header: "By", cell: (i) => i.staffName ?? "—" },
            { header: "Result", cell: (i) => (i.summary?.error ? <span className="text-red-600">{i.summary.error}</span> : i.summary?.products ? `${i.summary.products.new} new / ${i.summary.products.existing} updated products · ${(i.summary.variants?.new ?? 0) + (i.summary.variants?.existing ?? 0)} variants` : "—") },
            { header: "Status", cell: (i) => <StatusBadge status={i.status === "previewed" ? "draft" : i.status} /> },
          ]}
        />
      </Card>
    </>
  );
}
