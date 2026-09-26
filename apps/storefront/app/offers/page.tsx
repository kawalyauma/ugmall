import Link from "next/link";
import { serverGet } from "@/lib/api";
import { Listing, type SearchParams } from "@/components/listing";

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
          <Link key={o.id} href={`/offers/${o.slug}`} className="rounded-2xl bg-accent p-5 text-white">
            {o.percentOff && <div className="text-3xl font-extrabold">-{o.percentOff}%</div>}
            <div className="text-lg font-bold">{o.title}</div>
            {o.description && <div className="text-sm">{o.description}</div>}
            {o.endsAt && <div className="mt-2 text-xs opacity-80">Ends {new Date(o.endsAt).toLocaleDateString("en-GB")}</div>}
          </Link>
        ))}
      </div>
      <Listing basePath="/offers" fixed={{ sale: "1" }} searchParams={await searchParams} title="Everything on sale" />
    </>
  );
}
