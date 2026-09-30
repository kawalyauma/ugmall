import type { MetadataRoute } from "next";
import { serverGet } from "@/lib/api";
import { storefrontUrl } from "@/lib/seo";

interface SitemapRecord {
  slug: string;
  updatedAt?: string;
  createdAt?: string;
  image: string | null;
}

interface SitemapData {
  categories: SitemapRecord[];
  products: SitemapRecord[];
  offers: SitemapRecord[];
  deals: SitemapRecord[];
}

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = storefrontUrl();
  const data = await serverGet<SitemapData>("/store/seo/sitemap", { revalidate: 300 }).catch(() => ({ categories: [], products: [], offers: [], deals: [] }));
  const entry = (path: string, item: SitemapRecord, priority: number): MetadataRoute.Sitemap[number] => ({
    url: `${base}${path}`,
    lastModified: item.updatedAt ?? item.createdAt,
    images: item.image ? [new URL(item.image, base).toString()] : undefined,
    changeFrequency: "weekly",
    priority,
  });
  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/categories`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/offers`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/help`, changeFrequency: "monthly", priority: 0.5 },
    ...data.categories.map((item) => entry(`/c/${encodeURIComponent(item.slug)}`, item, 0.7)),
    ...data.products.map((item) => entry(`/p/${encodeURIComponent(item.slug)}`, item, 0.9)),
    ...data.offers.map((item) => entry(`/offers/${encodeURIComponent(item.slug)}`, item, 0.8)),
    ...data.deals.map((item) => entry(`/deals/${encodeURIComponent(item.slug)}`, item, 0.8)),
  ];
}
