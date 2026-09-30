import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Listing, type SearchParams } from "@/components/listing";
import { serverGet } from "@/lib/api";

interface Offer {
  slug: string;
  title: string;
  description: string | null;
  banner?: string | null;
}

async function getOffer(slug: string) {
  const offers = await serverGet<Offer[]>("/store/offers").catch(() => []);
  return offers.find((offer) => offer.slug === slug) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const offer = await getOffer((await params).slug);
  return offer
    ? { title: offer.title, description: offer.description ?? undefined, alternates: { canonical: `/offers/${offer.slug}` }, openGraph: { title: offer.title, description: offer.description ?? undefined, images: offer.banner ? [offer.banner] : undefined } }
    : { title: "Offer not found", robots: { index: false, follow: false } };
}

export default async function OfferPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const { slug } = await params;
  const offer = await getOffer(slug);
  if (!offer) notFound();
  return <Listing basePath={`/offers/${slug}`} fixed={{ offer: slug }} searchParams={await searchParams} title={offer.title} subtitle={offer.description ?? undefined} />;
}
