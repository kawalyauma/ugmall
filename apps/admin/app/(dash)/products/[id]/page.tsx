"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Trash2, Upload } from "lucide-react";
import { PRODUCT_STATUSES, variantLabel } from "@ugmall/shared";
import { api, upload } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Card, Modal, PageHeader, StatusBadge, Table, money } from "@/components/ui/kit";

interface Variant {
  id: string;
  sku: string;
  options: Record<string, string>;
  price: number | null;
  salePrice: number | null;
  costPrice: number | null;
  lowStockThreshold: number;
  isActive: boolean;
  onHand: number;
  reserved: number;
  available: number;
}
interface Img {
  id: string;
  url: string;
  thumb: string | null;
  alt: string | null;
  storagePath: string;
  fileSize: number;
  width: number;
  height: number;
}
interface Product {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string | null;
  categoryId: string | null;
  brandId: string | null;
  price: number;
  costPrice: number;
  salePrice: number | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  weightGrams: number | null;
  status: string;
  isFeatured: boolean;
  sizes: string[];
  colours: string[];
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  variants: Variant[];
  images: Img[];
}

const EMPTY = { name: "", sku: "", slug: "", description: "", categoryId: "", brandId: "", price: "", costPrice: "", salePrice: "", saleStartsAt: "", saleEndsAt: "", weightGrams: "", status: "draft", isFeatured: false, tags: "", seoTitle: "", seoDescription: "" };

export default function ProductEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === "new";
  const router = useRouter();
  const toast = useToast();
  const { data: p, reload } = useApi<Product>(isNew ? null : `/admin/products/${id}`);
  const { data: cats } = useApi<{ items: { id: string; name: string }[] }>("/admin/categories?limit=500");
  const { data: brands } = useApi<{ items: { id: string; name: string }[] }>("/admin/brands?limit=500");
  const [f, setF] = useState<Record<string, string | boolean>>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [grid, setGrid] = useState({ sizes: "", colours: "", openingStock: "0" });
  const [editVariant, setEditVariant] = useState<Variant | null>(null);
  const [vf, setVf] = useState<Record<string, string>>({});
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!p) return;
    setF({
      name: p.name, sku: p.sku, slug: p.slug, description: p.description ?? "", categoryId: p.categoryId ?? "", brandId: p.brandId ?? "",
      price: String(p.price), costPrice: String(p.costPrice), salePrice: p.salePrice ? String(p.salePrice) : "",
      saleStartsAt: p.saleStartsAt?.slice(0, 16) ?? "", saleEndsAt: p.saleEndsAt?.slice(0, 16) ?? "",
      weightGrams: p.weightGrams ? String(p.weightGrams) : "", status: p.status, isFeatured: p.isFeatured, tags: p.tags.join(", "),
      seoTitle: p.seoTitle ?? "", seoDescription: p.seoDescription ?? "",
    });
  }, [p]);

  async function save() {
    setBusy(true);
    const n = (v: unknown) => (v === "" || v === undefined ? null : Number(v));
    const body = {
      name: f.name, sku: f.sku, slug: f.slug || undefined, description: f.description || null,
      categoryId: f.categoryId || null, brandId: f.brandId || null,
      price: Number(f.price), costPrice: Number(f.costPrice || 0), salePrice: n(f.salePrice),
      saleStartsAt: f.saleStartsAt ? new Date(String(f.saleStartsAt)).toISOString() : null,
      saleEndsAt: f.saleEndsAt ? new Date(String(f.saleEndsAt)).toISOString() : null,
      weightGrams: n(f.weightGrams), status: f.status, isFeatured: f.isFeatured,
      tags: String(f.tags).split(",").map((t) => t.trim()).filter(Boolean),
      seoTitle: f.seoTitle || null, seoDescription: f.seoDescription || null,
    };
    try {
      if (isNew) {
        const r = await api<{ id: string }>("/admin/products", { body });
        toast("Product created — now add sizes and photos");
        router.replace(`/products/${r.id}`);
      } else {
        await api(`/admin/products/${id}`, { method: "PATCH", body });
        toast("Saved");
        await reload();
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const images = p?.images ?? [];
  const move = (idx: number, dir: -1 | 1) => {
    const ids = images.map((i) => i.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j]!, ids[idx]!];
    void run(() => api(`/admin/products/${id}/images/order`, { method: "PUT", body: { ids } }), "Order saved");
  };

  return (
    <>
      <PageHeader
        title={isNew ? "New product" : (p?.name ?? "…")}
        subtitle={p ? `SKU ${p.sku}` : undefined}
        actions={
          <>
            {!isNew && (
              <Button variant="ghost" className="text-red-600" onClick={() => confirm("Delete (or archive if it has orders)?") && run(async () => { const r = await api<{ message?: string }>(`/admin/products/${id}`, { method: "DELETE" }); if (r.message) toast(r.message); router.push("/products"); }, "Done")}>
                Delete
              </Button>
            )}
            <Button onClick={save} loading={busy}>Save</Button>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card title="Details">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name *" className="sm:col-span-2"><Input value={String(f.name)} onChange={(e) => set("name", e.target.value)} /></Field>
              <Field label="SKU *" hint="e.g. BLUE-JEANS-001"><Input value={String(f.sku)} onChange={(e) => set("sku", e.target.value.toUpperCase())} /></Field>
              <Field label="URL slug" hint="Generated from the name if empty"><Input value={String(f.slug)} onChange={(e) => set("slug", e.target.value)} /></Field>
              <Field label="Category">
                <Select value={String(f.categoryId)} onChange={(e) => set("categoryId", e.target.value)}>
                  <option value="">—</option>
                  {cats?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Brand">
                <Select value={String(f.brandId)} onChange={(e) => set("brandId", e.target.value)}>
                  <option value="">—</option>
                  {brands?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Description" className="sm:col-span-2"><Textarea rows={5} value={String(f.description)} onChange={(e) => set("description", e.target.value)} /></Field>
            </div>
          </Card>
          <Card title="Pricing (UGX)">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Selling price *"><Input type="number" value={String(f.price)} onChange={(e) => set("price", e.target.value)} /></Field>
              <Field label="Cost price" hint="For profit reports"><Input type="number" value={String(f.costPrice)} onChange={(e) => set("costPrice", e.target.value)} /></Field>
              <Field label="Discounted price"><Input type="number" value={String(f.salePrice)} onChange={(e) => set("salePrice", e.target.value)} /></Field>
              <Field label="Discount starts"><Input type="datetime-local" value={String(f.saleStartsAt)} onChange={(e) => set("saleStartsAt", e.target.value)} /></Field>
              <Field label="Discount ends"><Input type="datetime-local" value={String(f.saleEndsAt)} onChange={(e) => set("saleEndsAt", e.target.value)} /></Field>
              <Field label="Weight (grams)" hint="Used for upcountry delivery"><Input type="number" value={String(f.weightGrams)} onChange={(e) => set("weightGrams", e.target.value)} /></Field>
            </div>
          </Card>

          {!isNew && p && (
            <Card title={`Variants & stock (${p.variants.length})`}>
              <div className="mb-4 grid gap-2 rounded-xl bg-gray-50 p-3 sm:grid-cols-[1fr_1fr_120px_auto]">
                <Input className="h-10" placeholder="Sizes: 30, 31, 32 … or S, M, L" value={grid.sizes} onChange={(e) => setGrid((g) => ({ ...g, sizes: e.target.value }))} />
                <Input className="h-10" placeholder="Colours (optional): Blue, Black" value={grid.colours} onChange={(e) => setGrid((g) => ({ ...g, colours: e.target.value }))} />
                <Input className="h-10" type="number" placeholder="Opening stock each" value={grid.openingStock} onChange={(e) => setGrid((g) => ({ ...g, openingStock: e.target.value }))} />
                <Button
                  className="h-10"
                  onClick={() =>
                    run(async () => {
                      const split = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
                      const r = await api<{ created: string[] }>(`/admin/products/${id}/variants/generate`, { body: { sizes: split(grid.sizes), colours: split(grid.colours), openingStock: Number(grid.openingStock || 0) } });
                      toast(`Created ${r.created.length} variants`);
                      setGrid({ sizes: "", colours: "", openingStock: "0" });
                    }, "Variants generated")
                  }
                >
                  Generate
                </Button>
              </div>
              <Table
                rows={p.variants}
                onRowClick={(v) => { setEditVariant(v); setVf({ price: v.price ? String(v.price) : "", salePrice: v.salePrice ? String(v.salePrice) : "", costPrice: v.costPrice ? String(v.costPrice) : "", lowStockThreshold: String(v.lowStockThreshold) }); }}
                columns={[
                  { header: "Variant", cell: (v) => variantLabel(v.options) || "Default" },
                  { header: "SKU", cell: (v) => <code className="text-xs">{v.sku}</code> },
                  { header: "Price", cell: (v) => money(v.salePrice ?? v.price ?? p.salePrice ?? p.price) },
                  { header: "On hand", cell: (v) => v.onHand },
                  { header: "Reserved", cell: (v) => v.reserved },
                  { header: "Available", cell: (v) => <StatusBadge status={v.available <= 0 ? "out" : v.available <= v.lowStockThreshold ? "low" : "ok"} /> },
                  { header: "", cell: (v) => <span className="font-semibold">{v.available}</span> },
                  { header: "Active", cell: (v) => (v.isActive ? "✓" : "—") },
                ]}
              />
              <p className="mt-2 text-xs text-gray-500">Adjust stock levels on the Inventory page (every change is recorded in the audit trail).</p>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Visibility">
            <div className="space-y-3">
              <Field label="Status">
                <Select value={String(f.status)} onChange={(e) => set("status", e.target.value)}>
                  {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-brand-700" checked={Boolean(f.isFeatured)} onChange={(e) => set("isFeatured", e.target.checked)} /> Featured on home page
              </label>
              <Field label="Tags" hint="Comma separated, helps search"><Input value={String(f.tags)} onChange={(e) => set("tags", e.target.value)} /></Field>
            </div>
          </Card>
          {!isNew && (
            <Card
              title={`Photos (${images.length})`}
              actions={
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white">
                  <Upload className="size-4" /> Upload
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    multiple
                    className="hidden"
                    onChange={async (e) => {
                      const files = Array.from(e.target.files ?? []);
                      for (const file of files) await upload(`/admin/products/${id}/images`, file, { alt: String(f.name) }).catch((err) => toast(err.message, "error"));
                      e.target.value = "";
                      toast(`${files.length} photo(s) uploaded`);
                      await reload();
                    }}
                  />
                </label>
              }
            >
              <p className="mb-2 text-xs text-gray-500">Stored on your server under storage/products/…/{p?.sku}/ and converted to WebP (main, medium, thumbnail). First photo is the main image.</p>
              <div className="grid grid-cols-2 gap-2">
                {images.map((im, idx) => (
                  <div key={im.id} className="group relative overflow-hidden rounded-xl border border-gray-200">
                    <img src={im.thumb ?? im.url} alt="" className="aspect-square w-full object-cover" />
                    {idx === 0 && <span className="absolute left-1 top-1 rounded bg-brand-700 px-1.5 text-[10px] text-white">Main</span>}
                    <div className="flex justify-between bg-white p-1">
                      <button onClick={() => move(idx, -1)} aria-label="Move left"><ArrowUp className="size-4 -rotate-90" /></button>
                      <span className="text-[10px] text-gray-400">{Math.round(im.fileSize / 1024)}KB</span>
                      <button onClick={() => move(idx, 1)} aria-label="Move right"><ArrowDown className="size-4 -rotate-90" /></button>
                      <button onClick={() => confirm("Delete photo?") && run(() => api(`/admin/product-images/${im.id}`, { method: "DELETE" }), "Deleted")} aria-label="Delete"><Trash2 className="size-4 text-red-500" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          <Card title="SEO">
            <div className="space-y-3">
              <Field label="SEO title"><Input value={String(f.seoTitle)} onChange={(e) => set("seoTitle", e.target.value)} /></Field>
              <Field label="SEO description"><Textarea value={String(f.seoDescription)} onChange={(e) => set("seoDescription", e.target.value)} /></Field>
            </div>
          </Card>
        </div>
      </div>

      <Modal open={!!editVariant} onClose={() => setEditVariant(null)} title={`Edit ${editVariant ? variantLabel(editVariant.options) : ""}`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Price override" hint="Empty = product price"><Input type="number" value={vf.price ?? ""} onChange={(e) => setVf((s) => ({ ...s, price: e.target.value }))} /></Field>
          <Field label="Discounted price"><Input type="number" value={vf.salePrice ?? ""} onChange={(e) => setVf((s) => ({ ...s, salePrice: e.target.value }))} /></Field>
          <Field label="Cost price"><Input type="number" value={vf.costPrice ?? ""} onChange={(e) => setVf((s) => ({ ...s, costPrice: e.target.value }))} /></Field>
          <Field label="Low-stock threshold"><Input type="number" value={vf.lowStockThreshold ?? ""} onChange={(e) => setVf((s) => ({ ...s, lowStockThreshold: e.target.value }))} /></Field>
        </div>
        <div className="mt-4 flex justify-between">
          <Button variant="ghost" className="text-red-600" onClick={() => editVariant && run(() => api(`/admin/variants/${editVariant.id}`, { method: "DELETE" }), "Removed").then(() => setEditVariant(null))}>
            Remove variant
          </Button>
          <Button
            onClick={() =>
              editVariant &&
              run(
                () =>
                  api(`/admin/variants/${editVariant.id}`, {
                    method: "PATCH",
                    body: {
                      price: vf.price ? Number(vf.price) : null,
                      salePrice: vf.salePrice ? Number(vf.salePrice) : null,
                      costPrice: vf.costPrice ? Number(vf.costPrice) : null,
                      lowStockThreshold: Number(vf.lowStockThreshold || 0),
                    },
                  }),
                "Variant saved",
              ).then(() => setEditVariant(null))
            }
          >
            Save
          </Button>
        </div>
      </Modal>
    </>
  );
}
