import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { looksLikeHtml, sanitizeHtml, htmlToText } from "@ugmall/shared";
import { ApiError, serverGet } from "@/lib/api";
import type { ProductDetail, ShopSettings } from "@/lib/types";
import { ProductGrid } from "@/components/product-card";
import { ProductPurchase } from "./purchase";
import { Reviews } from "./reviews";

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  try {
    return await serverGet<ProductDetail>(`/store/products/${encodeURIComponent(slug)}`, { revalidate: 15 });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await load((await params).slug);
  if (!p) return { title: "Product not found" };
  const img = p.images[0]?.url;
  return {
    title: p.seo.title,
    description: p.seo.description ?? undefined,
    openGraph: { title: p.seo.title, description: p.seo.description ?? undefined, images: img ? [img] : undefined },
    alternates: { canonical: `/p/${p.slug}` },
  };
}

export default async function ProductPage({ params }: Props) {
  const p = await load((await params).slug);
  if (!p) notFound();
  const settings = await serverGet<ShopSettings>("/store/settings");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    sku: p.sku,
    image: p.images.map((i) => i.url).filter(Boolean),
    description: p.description ? htmlToText(p.description) : undefined,
    brand: p.brand ? { "@type": "Brand", name: p.brand } : undefined,
    aggregateRating: p.rating ? { "@type": "AggregateRating", ratingValue: p.rating.average, reviewCount: p.rating.count } : undefined,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "UGX",
      lowPrice: Math.min(...p.variants.map((v) => v.price), p.price),
      highPrice: Math.max(...p.variants.map((v) => v.price), p.price),
      availability: p.variants.some((v) => v.available > 0) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };
  return (
    <div className="container-page py-4">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <nav className="mb-3 text-xs text-gray-500">
        <Link href="/">Home</Link>
        {p.category && (
          <>
            {" / "}
            <Link href={`/c/${p.category.slug}`}>{p.category.name}</Link>
          </>
        )}
      </nav>
      <ProductPurchase product={p} whatsappNumber={settings.whatsappNumber} />
      {p.description && (
        <section className="mt-8 rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="mb-2 font-bold">Description</h2>
          {looksLikeHtml(p.description) ? (
            // Sanitised again at render time: only simple formatting tags, no attributes.
            <div className="prose-shop text-sm leading-relaxed text-gray-700" dangerouslySetInnerHTML={{ __html: sanitizeHtml(p.description) }} />
          ) : (
            <div className="whitespace-pre-line text-sm leading-relaxed text-gray-700">{p.description}</div>
          )}
        </section>
      )}
      {Object.keys(p.attributes ?? {}).length > 0 && (
        <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="mb-2 font-bold">Details</h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {Object.entries(p.attributes).map(([k, v]) => (
              <div key={k} className="flex gap-2 border-b border-gray-100 pb-2">
                <dt className="w-32 shrink-0 text-gray-500">{k}</dt>
                <dd className="text-gray-800">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <Reviews productId={p.id} rating={p.rating} />
      {p.related.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-bold">You may also like</h2>
          <ProductGrid items={p.related} />
        </section>
      )}
    </div>
  );
}
