import Link from "next/link";
import { serverGet } from "@/lib/api";
import { Listing, type SearchParams } from "@/components/listing";
import { Countdown } from "@/components/countdown";

export const metadata = { title: "Offers" };

interface Offer {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  percentOff: number | null;
  endsAt: string | null;
  banner: string | null;
}

export default async function OffersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const offers = await serverGet<Offer[]>("/store/offers").catch(() => []);
  return (
    <>
      <div className="container-page grid gap-3 pt-5 md:grid-cols-2">
        {offers.map((o) => (
          <Link key={o.id} href={`/offers/${o.slug}`} className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-orange-500 to-accent p-5 text-white">
            {o.banner && <img src={o.banner} alt="" className="absolute inset-0 size-full object-cover opacity-30" />}
            <div className="relative">
              {o.percentOff && <div className="text-3xl font-extrabold">-{o.percentOff}%</div>}
              <div className="text-lg font-bold">{o.title}</div>
              {o.description && <div className="text-sm">{o.description}</div>}
              {o.endsAt && <Countdown endsAt={o.endsAt} className="mt-2 inline-block rounded-lg bg-black/20 px-2 py-1 text-xs" />}
            </div>
          </Link>
        ))}
      </div>
      <Listing basePath="/offers" fixed={{ sale: "1" }} searchParams={await searchParams} title="Everything on promotion" />
    </>
  );
}
