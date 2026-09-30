import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Listing, type SearchParams } from "@/components/listing";
import { Countdown } from "@/components/countdown";
import { ApiError, serverGet } from "@/lib/api";

interface Deal {
  id: string;
  title: string;
  slug: string;
  subtitle: string | null;
  endsAt: string | null;
  image: string | null;
}

async function getDeal(slug: string) {
  return serverGet<Deal>(`/store/deals/${encodeURIComponent(slug)}`).catch((e) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const deal = await getDeal((await params).slug);
  return deal
    ? { title: deal.title, description: deal.subtitle ?? undefined, alternates: { canonical: `/deals/${deal.slug}` }, openGraph: { title: deal.title, description: deal.subtitle ?? undefined, images: deal.image ? [deal.image] : undefined } }
    : { title: "Deal not found", robots: { index: false, follow: false } };
}

export default async function DealPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const { slug } = await params;
  const deal = await getDeal(slug);
  if (!deal) notFound();
  return (
    <>
      {deal.image && (
        <div className="container-page pt-4">
          <img src={deal.image} alt={deal.title} className="aspect-[2/1] w-full rounded-2xl object-cover md:aspect-[3/1]" />
        </div>
      )}
      {deal.endsAt && (
        <div className="container-page pt-3">
          <Countdown endsAt={deal.endsAt} className="inline-block rounded-lg bg-orange-100 px-3 py-1.5 text-sm text-orange-800" />
        </div>
      )}
      <Listing basePath={`/deals/${slug}`} fixed={{ deal: slug }} searchParams={await searchParams} title={deal.title} subtitle={deal.subtitle ?? undefined} />
    </>
  );
}
