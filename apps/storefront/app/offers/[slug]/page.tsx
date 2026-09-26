import { Listing, type SearchParams } from "@/components/listing";
import { serverGet } from "@/lib/api";

export default async function OfferPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const { slug } = await params;
  const offers = await serverGet<{ slug: string; title: string; description: string | null }[]>("/store/offers").catch(() => []);
  const o = offers.find((x) => x.slug === slug);
  return <Listing basePath={`/offers/${slug}`} fixed={{ offer: slug }} searchParams={await searchParams} title={o?.title ?? "Offer"} subtitle={o?.description ?? undefined} />;
}
