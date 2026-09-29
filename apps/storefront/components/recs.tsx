"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Clock, Compass, Eye, Flame, Sparkles, Tag } from "lucide-react";
import { api } from "@/lib/api";
import { track } from "@/lib/track";
import type { ProductCard as P, RecommendedProduct } from "@/lib/types";
import { ProductCard, ProductGrid } from "./product-card";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------ tracking */

/** Records a product view, and a "dwell" once the shopper has spent 15s with the page visible. */
export function TrackProductView({ productId }: { productId: string }) {
  useEffect(() => {
    track({ type: "view", productId });
    let visibleMs = 0;
    let last = Date.now();
    let sent = false;
    const iv = setInterval(() => {
      const now = Date.now();
      if (document.visibilityState === "visible") visibleMs += now - last;
      last = now;
      if (!sent && visibleMs >= 15_000) {
        sent = true;
        track({ type: "dwell", productId });
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [productId]);
  return null;
}

export function TrackBrowse({ categorySlug, query }: { categorySlug?: string; query?: string }) {
  useEffect(() => {
    if (categorySlug) track({ type: "category", categorySlug });
    if (query?.trim()) track({ type: "search", query: query.trim() });
  }, [categorySlug, query]);
  return null;
}

/* ------------------------------------------------------------ pieces */

const REASON: Record<RecommendedProduct["reason"], { label: string; className: string } | null> = {
  for_you: { label: "For you", className: "bg-brand-700/90 text-white" },
  similar: { label: "Similar to what you viewed", className: "bg-brand-700/90 text-white" },
  trending: { label: "Trending", className: "bg-orange-500/90 text-white" },
  new: { label: "New", className: "bg-sky-600/90 text-white" },
  deal: null, // the discount badge already says it
  explore: { label: "Discover", className: "bg-violet-600/90 text-white" },
  popular: null,
};

function RecCard({ p }: { p: RecommendedProduct }) {
  const r = REASON[p.reason];
  return (
    <div className="relative">
      <ProductCard p={p} />
      {r && p.discountPercent === 0 && (
        <span className={cn("pointer-events-none absolute left-2 top-2 max-w-[85%] truncate rounded-full px-2 py-0.5 text-[10px] font-bold backdrop-blur", r.className)}>{r.label}</span>
      )}
    </div>
  );
}

function SkeletonGrid({ n = 8 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="aspect-[4/5] animate-pulse bg-gray-100" />
          <div className="space-y-2 p-3">
            <div className="h-3 animate-pulse rounded bg-gray-100" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({ icon: Icon, title, subtitle, href, items, accent }: { icon: typeof Sparkles; title: string; subtitle?: string; href?: string; items: RecommendedProduct[]; accent: string }) {
  if (!items.length) return null;
  return (
    <section className="container-page mt-10">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xl font-black tracking-tight md:text-2xl">
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", accent)}><Icon className="size-4" /></span>
            <span className="truncate">{title}</span>
          </h2>
          {subtitle && <p className="mt-1 text-sm text-gray-600">{subtitle}</p>}
        </div>
        {href && <Link href={href} className="hidden shrink-0 items-center gap-1 text-sm font-bold text-brand-700 sm:inline-flex">View all <ArrowRight className="size-4" /></Link>}
      </div>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
        {items.map((p) => (
          <div key={p.id} className="w-40 shrink-0 snap-start md:w-48">
            <RecCard p={p} />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ home rows */

interface HomeRows {
  continueBrowsing: RecommendedProduct[];
  becauseYouViewed: { product: { name: string; slug: string }; items: RecommendedProduct[] } | null;
  trending: { category: { name: string; slug: string } | null; items: RecommendedProduct[] };
  newForYou: RecommendedProduct[];
}

/** Personal rows near the top of the home page. Different on every visit. */
export function ForYouRows() {
  const [rows, setRows] = useState<HomeRows | null>(null);
  useEffect(() => {
    api<HomeRows>("/store/feed/home").then(setRows, () => setRows(null));
  }, []);
  if (!rows) return null;
  return (
    <>
      <Row icon={Clock} title="Continue where you left off" items={rows.continueBrowsing} accent="bg-gray-900 text-white" />
      {rows.becauseYouViewed && (
        <Row icon={Eye} title={`Because you viewed ${rows.becauseYouViewed.product.name}`} subtitle="Similar picks, chosen for you" href={`/p/${rows.becauseYouViewed.product.slug}`} items={rows.becauseYouViewed.items} accent="bg-brand-100 text-brand-800" />
      )}
      <Row
        icon={Flame}
        title={rows.trending.category ? `Trending in ${rows.trending.category.name}` : "Trending now"}
        subtitle="What shoppers are viewing and buying right now"
        href={rows.trending.category ? `/c/${rows.trending.category.slug}` : "/search?sort=popular"}
        items={rows.trending.items}
        accent="bg-orange-100 text-orange-700"
      />
      <Row icon={Tag} title="New arrivals for you" href="/search?sort=newest" items={rows.newForYou} accent="bg-sky-100 text-sky-800" />
    </>
  );
}

/* ------------------------------------------------------------ infinite feed */

/** Endless personal feed: loads more as the shopper scrolls; each visit is freshly ranked. */
export function ForYouFeed({ category, title = "For you", subtitle = "Picked from what you browse, search and buy — refreshed every visit." }: { category?: string; title?: string; subtitle?: string }) {
  const [items, setItems] = useState<RecommendedProduct[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (loading || cursor === null) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "24" });
      if (cursor) qs.set("cursor", cursor);
      if (category) qs.set("category", category);
      const r = await api<{ items: RecommendedProduct[]; cursor: string | null }>(`/store/feed?${qs}`);
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...r.items.filter((p) => !seen.has(p.id))];
      });
      setCursor(r.cursor);
    } catch {
      setCursor(null);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, category]);

  useEffect(() => {
    if (cursor === undefined) void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || cursor === null) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void loadMore(), { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, cursor]);

  if (cursor === null && !items.length) return null;
  return (
    <section className="container-page mt-12">
      <div className="mb-4">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-700 to-violet-600 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-white">
          <Sparkles className="size-3.5" /> Your feed
        </div>
        <h2 className="text-2xl font-black tracking-tight md:text-3xl">{title}</h2>
        <p className="mt-1 text-sm text-gray-600">{subtitle}</p>
      </div>
      {items.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
          {items.map((p) => (
            <RecCard key={p.id} p={p} />
          ))}
        </div>
      ) : (
        <SkeletonGrid />
      )}
      <div ref={sentinel} className="h-px" />
      {loading && items.length > 0 && <div className="py-6 text-center text-sm text-gray-400">Finding more for you…</div>}
      {cursor === null && items.length > 0 && (
        <div className="py-8 text-center text-sm text-gray-500">
          <Compass className="mx-auto mb-2 size-6 text-gray-300" />
          You've reached the end — <Link href="/categories" className="font-semibold text-brand-700">browse all categories</Link>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ product page */

/** Personalised "You may also like"; shows the server-rendered list until it loads. */
export function YouMayAlsoLike({ productId, fallback }: { productId: string; fallback: P[] }) {
  const [items, setItems] = useState<RecommendedProduct[] | null>(null);
  useEffect(() => {
    api<{ items: RecommendedProduct[] }>(`/store/products/${productId}/recommendations?limit=12`).then(
      (r) => setItems(r.items),
      () => setItems(null),
    );
  }, [productId]);
  const list = items && items.length >= 4 ? items : null;
  if (!list && !fallback.length) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-bold">You may also like</h2>
      {list ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
          {list.map((p) => (
            <RecCard key={p.id} p={p} />
          ))}
        </div>
      ) : (
        <ProductGrid items={fallback} />
      )}
    </section>
  );
}
