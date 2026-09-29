import Link from "next/link";
import { cookies } from "next/headers";
import { serverGet } from "@/lib/api";
import { TrackBrowse } from "./recs";
import type { ProductCard } from "@/lib/types";
import { ProductGrid } from "./product-card";
import { cn } from "@/lib/utils";

export type SearchParams = Record<string, string | string[] | undefined>;

const SORTS = [
  ["foryou", "For you"],
  ["newest", "Newest"],
  ["popular", "Popular"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
] as const;

function qs(base: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Server-rendered product listing with URL-driven filters (works without JS, good for SEO and slow phones). */
export async function Listing({ basePath, fixed, searchParams, title, subtitle }: { basePath: string; fixed: Record<string, string>; searchParams: SearchParams; title: string; subtitle?: string }) {
  const sp: Record<string, string | undefined> = {};
  for (const k of ["sort", "size", "min", "max", "page", "q", "sale", "brand"]) {
    const v = searchParams[k];
    sp[k] = Array.isArray(v) ? v[0] : v;
  }
  const page = Math.max(1, Number(sp.page ?? 1));
  const query = new URLSearchParams({ ...fixed, limit: "24" });
  for (const [k, v] of Object.entries(sp)) if (v) query.set(k, v);
  if (!query.has("sort")) query.set("sort", "foryou");
  // "For you" is personal: forward the shopper's cookies and skip the shared cache.
  const personal = query.get("sort") === "foryou";
  const cookie = personal
    ? (await cookies())
        .getAll()
        .filter((c) => c.name === "ugm_vid" || c.name === "ugm_session")
        .map((c) => `${c.name}=${c.value}`)
        .join("; ")
    : undefined;
  const data = await serverGet<{ items: ProductCard[]; total: number }>(`/store/products?${query}`, personal ? { revalidate: 0, cookie } : { revalidate: 20 });
  const sizes = [...new Set(data.items.flatMap((p) => p.sizes))].slice(0, 20);
  const pages = Math.ceil(data.total / 24);

  return (
    <div className="container-page py-5">
      {page === 1 && <TrackBrowse categorySlug={fixed.category} query={sp.q} />}
      <div className="mb-4">
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-gray-600">{subtitle}</p>}
        <p className="mt-1 text-xs text-gray-500">{data.total} products</p>
      </div>
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 text-sm">
        {SORTS.map(([v, l]) => (
          <Link key={v} href={`${basePath}${qs(sp, { sort: v, page: undefined })}`} className={cn("shrink-0 rounded-full border px-3 py-1.5", (sp.sort ?? "foryou") === v ? "border-brand-700 bg-brand-700 text-white" : "border-gray-300 bg-white")}>
            {l}
          </Link>
        ))}
        <Link href={`${basePath}${qs(sp, { sale: sp.sale ? undefined : "1", page: undefined })}`} className={cn("shrink-0 rounded-full border px-3 py-1.5", sp.sale ? "border-accent bg-accent text-white" : "border-gray-300 bg-white")}>
          On sale
        </Link>
      </div>
      {sizes.length > 0 && (
        <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 text-sm">
          <span className="shrink-0 py-1.5 text-gray-500">Size:</span>
          {sizes.map((s) => (
            <Link key={s} href={`${basePath}${qs(sp, { size: sp.size === s ? undefined : s, page: undefined })}`} className={cn("shrink-0 rounded-lg border px-3 py-1.5", sp.size === s ? "border-brand-700 bg-brand-50 font-semibold text-brand-800" : "border-gray-300 bg-white")}>
              {s}
            </Link>
          ))}
        </div>
      )}
      <ProductGrid items={data.items} />
      {pages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-3 text-sm">
          {page > 1 && (
            <Link className="rounded-lg border bg-white px-4 py-2" href={`${basePath}${qs(sp, { page: String(page - 1) })}`}>
              ← Previous
            </Link>
          )}
          <span className="text-gray-500">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link className="rounded-lg border bg-white px-4 py-2" href={`${basePath}${qs(sp, { page: String(page + 1) })}`}>
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
