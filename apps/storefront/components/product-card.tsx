import Link from "next/link";
import { Star } from "lucide-react";
import type { ProductCard as P } from "@/lib/types";
import { Price } from "./price";

export function ProductCard({ p }: { p: P }) {
  return (
    <Link href={`/p/${p.slug}`} className="group block overflow-hidden rounded-2xl border border-gray-200 bg-white transition hover:shadow-md">
      <div className="relative aspect-[4/5] bg-gray-100">
        {p.image ? (
          // Images are pre-resized WebP renditions served by Nginx; srcset picks the right one.
          <img
            src={p.image.medium ?? p.image.url ?? ""}
            srcSet={[p.image.thumb && `${p.image.thumb} 400w`, p.image.medium && `${p.image.medium} 800w`].filter(Boolean).join(", ")}
            sizes="(min-width: 768px) 25vw, 50vw"
            alt={p.image.alt ?? p.name}
            loading="lazy"
            className="size-full object-cover transition group-hover:scale-[1.02]"
          />
        ) : (
          <div className="grid size-full place-items-center text-xs text-gray-400">No image</div>
        )}
        {p.discountPercent > 0 && <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white">-{p.discountPercent}%</span>}
        {!p.inStock && <span className="absolute inset-x-0 bottom-0 bg-gray-900/70 py-1 text-center text-xs font-semibold text-white">Sold out</span>}
      </div>
      <div className="space-y-1 p-3">
        <h3 className="line-clamp-2 text-sm font-medium text-gray-800">{p.name}</h3>
        <Price price={p.price} compareAt={p.compareAt} size="sm" />
        {p.rating && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Star className="size-3 fill-accent text-accent" /> {p.rating.average.toFixed(1)} ({p.rating.count})
          </div>
        )}
      </div>
    </Link>
  );
}

export function ProductGrid({ items }: { items: P[] }) {
  if (!items.length) return <p className="py-12 text-center text-gray-500">No products found.</p>;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
      {items.map((p) => (
        <ProductCard key={p.id} p={p} />
      ))}
    </div>
  );
}
