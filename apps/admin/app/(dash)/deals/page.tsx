"use client";

import { useEffect, useState } from "react";
import { ImagePlus, Plus, Search, X } from "lucide-react";
import { api, qs, upload } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Badge, Card, Modal, PageHeader, dt } from "@/components/ui/kit";
import { useToast } from "@/components/toast";

type ProductLite = { id: string; name: string; sku: string; status?: string; image: string | null };

type Deal = {
  id: string;
  title: string;
  slug: string;
  subtitle: string | null;
  productIds: string[];
  products: ProductLite[];
  sortOrder: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  image: string | null;
  mobileImage: string | null;
};

type Form = { title: string; subtitle: string; sortOrder: string; startsAt: string; endsAt: string; isActive: boolean; products: ProductLite[] };

/** ISO timestamp → value for <input type="datetime-local"> in the browser's timezone. */
const toLocalInput = (v: string | null) => {
  if (!v) return "";
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function dealState(d: Deal) {
  const now = Date.now();
  if (!d.isActive) return <Badge>Off</Badge>;
  if (d.endsAt && new Date(d.endsAt).getTime() <= now) return <Badge>Ended</Badge>;
  if (d.startsAt && new Date(d.startsAt).getTime() > now) return <Badge tone="blue">Scheduled</Badge>;
  if (!d.image) return <Badge tone="amber">No graphic</Badge>;
  return <Badge tone="green">Live</Badge>;
}

/** Slide graphic picker: shows the saved image, or a local preview of the file waiting to upload. */
function SlidePicker({ label, hint, current, file, onFile, aspect }: { label: string; hint: string; current: string | null; file: File | null; onFile: (f: File | null) => void; aspect: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const src = preview ?? current;
  return (
    <Field label={label} hint={hint}>
      <label className={`relative grid cursor-pointer place-items-center overflow-hidden rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500 hover:border-brand-600 ${aspect}`}>
        {src ? <img src={src} alt="" className="absolute inset-0 size-full object-cover" /> : null}
        <span className={`relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 ${src ? "bg-white/90 text-gray-800 shadow" : ""}`}>
          <ImagePlus className="size-4" /> {src ? "Replace" : "Choose image"}
        </span>
        <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      </label>
    </Field>
  );
}

function ProductPicker({ value, onChange }: { value: ProductLite[]; onChange: (v: ProductLite[]) => void }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, loading } = useApi<{ items: ProductLite[]; total: number }>(`/admin/products${qs({ q: term, status: "active", limit: 20 })}`);
  const chosen = new Set(value.map((p) => p.id));
  const results = (data?.items ?? []).filter((p) => !chosen.has(p.id));

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-xl border border-gray-200">
        <div className="relative border-b border-gray-200 p-2">
          <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <Input className="h-9 pl-8 text-sm" placeholder="Search products by name or SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {results.map((p) => (
            <button type="button" key={p.id} onClick={() => onChange([...value, p])} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50">
              <span className="size-9 shrink-0 overflow-hidden rounded-lg bg-gray-100">{p.image && <img src={p.image} alt="" className="size-full object-cover" />}</span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1">{p.name}</span>
                <span className="text-xs text-gray-400">{p.sku}</span>
              </span>
              <Plus className="size-4 shrink-0 text-brand-700" />
            </button>
          ))}
          {!loading && !results.length && <p className="px-3 py-6 text-center text-sm text-gray-400">No more products match.</p>}
        </div>
      </div>
      <div className="rounded-xl border border-gray-200">
        <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2.5 text-sm font-semibold">
          In this deal ({value.length})
          {value.length > 0 && (
            <button type="button" className="text-xs font-normal text-red-600" onClick={() => onChange([])}>
              Clear
            </button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto">
          {value.map((p) => (
            <div key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="size-9 shrink-0 overflow-hidden rounded-lg bg-gray-100">{p.image && <img src={p.image} alt="" className="size-full object-cover" />}</span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1">{p.name}</span>
                <span className="text-xs text-gray-400">
                  {p.sku}
                  {p.status && p.status !== "active" ? ` · ${p.status} (hidden from shop)` : ""}
                </span>
              </span>
              <button type="button" onClick={() => onChange(value.filter((x) => x.id !== p.id))} className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600" aria-label="Remove">
                <X className="size-4" />
              </button>
            </div>
          ))}
          {!value.length && <p className="px-3 py-6 text-center text-sm text-gray-400">Pick products from the left.</p>}
        </div>
      </div>
    </div>
  );
}

export default function DealsPage() {
  const toast = useToast();
  const { data, reload } = useApi<{ items: Deal[]; total: number }>("/admin/deals");
  const [editing, setEditing] = useState<Deal | "new" | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [files, setFiles] = useState<{ desktop: File | null; mobile: File | null }>({ desktop: null, mobile: null });
  const [busy, setBusy] = useState(false);

  function open(d: Deal | "new") {
    setEditing(d);
    setFiles({ desktop: null, mobile: null });
    setForm(
      d === "new"
        ? { title: "", subtitle: "", sortOrder: String((data?.items.length ?? 0) * 10), startsAt: "", endsAt: "", isActive: true, products: [] }
        : { title: d.title, subtitle: d.subtitle ?? "", sortOrder: String(d.sortOrder), startsAt: toLocalInput(d.startsAt), endsAt: toLocalInput(d.endsAt), isActive: d.isActive, products: d.products },
    );
  }
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  async function save() {
    if (!form || !editing) return;
    if (editing === "new" && !files.desktop) return toast("Add a slide graphic — it is what shoppers see in the slider", "error");
    setBusy(true);
    try {
      const body = {
        title: form.title,
        subtitle: form.subtitle.trim() || null,
        sortOrder: Number(form.sortOrder) || 0,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        isActive: form.isActive,
        productIds: form.products.map((p) => p.id),
      };
      const saved = editing === "new" ? await api<{ id: string }>("/admin/deals", { body }) : await api<{ id: string }>(`/admin/deals/${editing.id}`, { method: "PATCH", body });
      if (files.desktop) await upload(`/admin/deals/${saved.id}/image`, files.desktop);
      if (files.mobile) await upload(`/admin/deals/${saved.id}/image?kind=mobile`, files.mobile);
      toast("Deal saved");
      setEditing(null);
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing || editing === "new" || !confirm(`Delete the deal “${editing.title}”?`)) return;
    try {
      await api(`/admin/deals/${editing.id}`, { method: "DELETE" });
      setEditing(null);
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const current = editing && editing !== "new" ? editing : null;

  return (
    <>
      <PageHeader
        title="Deals"
        subtitle="Deals rotate automatically in the homepage slider. Upload the slide graphic and choose the products shoppers see when they tap it."
        actions={
          <Button onClick={() => open("new")}>
            <Plus className="size-4" /> New deal
          </Button>
        }
      />
      <Card>
        {!data ? (
          <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
        ) : !data.items.length ? (
          <p className="py-8 text-center text-sm text-gray-500">No deals yet. Create one to start the homepage slider.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.items.map((d) => (
              <button key={d.id} type="button" onClick={() => open(d)} className="overflow-hidden rounded-2xl border border-gray-200 text-left transition hover:shadow-md">
                <div className="aspect-[3/1] bg-gray-100">{d.image ? <img src={d.image} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-xs text-gray-400">No slide graphic</div>}</div>
                <div className="space-y-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">{d.title}</span>
                    {dealState(d)}
                  </div>
                  <div className="text-xs text-gray-500">
                    {d.productIds.length} product{d.productIds.length === 1 ? "" : "s"} · position {d.sortOrder}
                    {d.endsAt ? ` · ends ${dt(d.endsAt)}` : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "New deal" : "Edit deal"} wide>
        {form && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <SlidePicker label="Slide graphic (desktop) *" hint="Wide banner, about 1600 × 530 px (3:1)." aspect="aspect-[3/1]" current={current?.image ?? null} file={files.desktop} onFile={(f) => setFiles((x) => ({ ...x, desktop: f }))} />
              <SlidePicker label="Phone graphic (optional)" hint="About 800 × 400 px (2:1). Falls back to the desktop one." aspect="aspect-[2/1]" current={current?.mobileImage ?? null} file={files.mobile} onFile={(f) => setFiles((x) => ({ ...x, mobile: f }))} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title *" hint="Shown on the deal page and read aloud for accessibility.">
                <Input value={form.title} onChange={(e) => set("title", e.target.value)} required />
              </Field>
              <Field label="Slider position" hint="Lower numbers show first.">
                <Input type="number" min={0} value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} />
              </Field>
              <Field label="Subtitle" className="sm:col-span-2">
                <Textarea rows={2} value={form.subtitle} onChange={(e) => set("subtitle", e.target.value)} />
              </Field>
              <Field label="Starts" hint="Empty = immediately">
                <Input type="datetime-local" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
              </Field>
              <Field label="Ends" hint="Empty = no end date">
                <Input type="datetime-local" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
              </Field>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" className="size-5 accent-brand-700" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} /> Active
              </label>
            </div>
            <Field label="Products in this deal">
              <ProductPicker value={form.products} onChange={(v) => set("products", v)} />
            </Field>
            <div className="flex justify-between pt-1">
              {current ? (
                <Button variant="ghost" className="text-red-600" onClick={remove}>
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <Button onClick={save} loading={busy} disabled={!form.title.trim()}>
                Save deal
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
