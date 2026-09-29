import Link from "next/link";
import { SlidersHorizontal, X } from "lucide-react";
import { serverGet } from "@/lib/api";
import type { ProductCard } from "@/lib/types";
import { ProductGrid } from "./product-card";
import { cn } from "@/lib/utils";

export type SearchParams = Record<string, string | string[] | undefined>;
type Brand = { id: string; name: string; slug: string };

const SORTS = [
  ["newest", "Newest"],
  ["popular", "Popular"],
  ["rating", "Top rated"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
] as const;

function qs(base: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

function Hidden({ name, value }: { name: string; value?: string }) {
  return value ? <input type="hidden" name={name} value={value} /> : null;
}

function FilterPanel({ basePath, sp, brands, sizes, colours }: { basePath: string; sp: Record<string, string | undefined>; brands: Brand[]; sizes: string[]; colours: string[] }) {
  return (
    <div className="space-y-5">
      <form action={basePath} method="get" className="space-y-4">
        <Hidden name="q" value={sp.q} />
        <Hidden name="size" value={sp.size} />
        <Hidden name="colour" value={sp.colour} />
        <Hidden name="featured" value={sp.featured} />
        <div>
          <label htmlFor="sort" className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">Sort</label>
          <select id="sort" name="sort" defaultValue={sp.sort ?? "newest"} className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm">
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="brand" className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">Brand</label>
          <select id="brand" name="brand" defaultValue={sp.brand ?? ""} className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm">
            <option value="">All brands</option>
            {brands.map((b) => <option key={b.id} value={b.slug}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Price (UGX)</div>
          <div className="grid grid-cols-2 gap-2">
            <input name="min" inputMode="numeric" defaultValue={sp.min ?? ""} placeholder="Min" className="h-10 min-w-0 rounded-xl border border-gray-300 px-3 text-sm" />
            <input name="max" inputMode="numeric" defaultValue={sp.max ?? ""} placeholder="Max" className="h-10 min-w-0 rounded-xl border border-gray-300 px-3 text-sm" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="stock" value="1" defaultChecked={sp.stock === "1"} className="size-4 accent-brand-700" />In stock only</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sale" value="1" defaultChecked={sp.sale === "1"} className="size-4 accent-accent" />On sale</label>
        <button className="h-10 w-full rounded-xl bg-brand-700 px-4 text-sm font-bold text-white hover:bg-brand-800">Apply filters</button>
      </form>

      {sizes.length > 0 && <div><div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Size</div><div className="flex flex-wrap gap-2">{sizes.map((s) => <Link key={s} href={`${basePath}${qs(sp, { size: sp.size === s ? undefined : s, page: undefined })}`} className={cn("rounded-lg border px-2.5 py-1.5 text-xs", sp.size === s ? "border-brand-700 bg-brand-50 font-semibold text-brand-800" : "border-gray-300 bg-white")}>{s}</Link>)}</div></div>}
      {colours.length > 0 && <div><div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Colour</div><div className="flex flex-wrap gap-2">{colours.slice(0, 16).map((c) => <Link key={c} href={`${basePath}${qs(sp, { colour: sp.colour === c ? undefined : c, page: undefined })}`} className={cn("rounded-full border px-3 py-1.5 text-xs", sp.colour === c ? "border-brand-700 bg-brand-50 font-semibold text-brand-800" : "border-gray-300 bg-white")}>{c}</Link>)}</div></div>}
    </div>
  );
}

export async function Listing({ basePath, fixed, searchParams, title, subtitle }: { basePath: string; fixed: Record<string, string>; searchParams: SearchParams; title: string; subtitle?: string }) {
  const sp: Record<string, string | undefined> = {};
  for (const k of ["sort", "size", "colour", "min", "max", "page", "q", "sale", "brand", "stock", "featured"]) {
    const v = searchParams[k];
    sp[k] = Array.isArray(v) ? v[0] : v;
  }
  const page = Math.max(1, Number(sp.page ?? 1));
  const query = new URLSearchParams({ ...fixed, limit: "24", page: String(page) });
  for (const [k, v] of Object.entries(sp)) if (v && k !== "page") query.set(k, v);

  const [data, brands] = await Promise.all([
    serverGet<{ items: ProductCard[]; total: number }>(`/store/products?${query}`, { revalidate: 20 }),
    serverGet<Brand[]>("/store/brands", { revalidate: 120 }).catch(() => []),
  ]);
  const sizes = [...new Set(data.items.flatMap((p) => p.sizes))].slice(0, 24);
  const colours = [...new Set(data.items.flatMap((p) => p.colours))].slice(0, 24);
  const pages = Math.max(1, Math.ceil(data.total / 24));
  const hasFilters = ["size", "colour", "min", "max", "sale", "brand", "stock"].some((k) => Boolean(sp[k]));

  return (
    <div className="container-page py-5">
      <div className="mb-4">
        <h1 className="text-2xl font-black tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm leading-relaxed text-gray-600">{subtitle}</p>}
        <p className="mt-1 text-xs text-gray-500">{data.total} products</p>
      </div>

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 text-sm lg:hidden">
        {SORTS.map(([v, l]) => <Link key={v} href={`${basePath}${qs(sp, { sort: v, page: undefined })}`} className={cn("shrink-0 rounded-full border px-3 py-1.5", (sp.sort ?? "newest") === v ? "border-brand-700 bg-brand-700 text-white" : "border-gray-300 bg-white")}>{l}</Link>)}
      </div>

      <details className="mb-5 rounded-2xl border border-gray-200 bg-white p-4 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between font-semibold">
          <span className="flex items-center gap-2"><SlidersHorizontal className="size-4" /> Filters {hasFilters && <span className="size-2 rounded-full bg-accent" />}</span>
          {hasFilters && <Link href={sp.q ? `${basePath}?q=${encodeURIComponent(sp.q)}` : basePath} className="flex items-center gap-1 text-xs font-medium text-gray-500" onClick={(e) => e.stopPropagation()}><X className="size-3" /> Clear</Link>}
        </summary>
        <div className="mt-4 border-t border-gray-100 pt-4"><FilterPanel basePath={basePath} sp={sp} brands={brands} sizes={sizes} colours={colours} /></div>
      </details>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="hidden h-fit rounded-2xl border border-gray-200 bg-white p-4 lg:sticky lg:top-32 lg:block">
          <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2 font-bold"><SlidersHorizontal className="size-4" /> Filters</div>{hasFilters && <Link href={sp.q ? `${basePath}?q=${encodeURIComponent(sp.q)}` : basePath} className="text-xs text-brand-700 hover:underline">Clear</Link>}</div>
          <FilterPanel basePath={basePath} sp={sp} brands={brands} sizes={sizes} colours={colours} />
        </aside>

        <div>
          <ProductGrid items={data.items} />
          {pages > 1 && <div className="mt-8 flex items-center justify-center gap-3 text-sm">{page > 1 && <Link className="rounded-lg border bg-white px-4 py-2" href={`${basePath}${qs(sp, { page: String(page - 1) })}`}>← Previous</Link>}<span className="text-gray-500">Page {page} of {pages}</span>{page < pages && <Link className="rounded-lg border bg-white px-4 py-2" href={`${basePath}${qs(sp, { page: String(page + 1) })}`}>Next →</Link>}</div>}
        </div>
      </div>
    </div>
  );
}
