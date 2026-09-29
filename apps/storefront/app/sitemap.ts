import type { MetadataRoute } from "next";
import { serverGet } from "@/lib/api";
import type { Category, ProductCard } from "@/lib/types";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.STOREFRONT_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const [categories, first] = await Promise.all([
    serverGet<Category[]>("/store/categories", { revalidate: 300 }).catch(() => []),
    serverGet<{ items: ProductCard[]; total: number }>("/store/products?limit=60&page=1&sort=newest", { revalidate: 300 }).catch(() => ({ items: [], total: 0 })),
  ]);
  const pageCount = Math.ceil(first.total / 60);
  const rest = pageCount > 1 ? await Promise.all(Array.from({ length: pageCount - 1 }, (_, i) => serverGet<{ items: ProductCard[] }>(`/store/products?limit=60&page=${i + 2}&sort=newest`, { revalidate: 300 }).catch(() => ({ items: [] })))) : [];
  const products = [...first.items, ...rest.flatMap((r) => r.items)];
  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/categories`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/offers`, changeFrequency: "daily", priority: 0.8 },
    ...categories.map((c) => ({ url: `${base}/c/${c.slug}`, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...products.map((p) => ({ url: `${base}/p/${p.slug}`, changeFrequency: "weekly" as const, priority: 0.8 })),
  ];
}
