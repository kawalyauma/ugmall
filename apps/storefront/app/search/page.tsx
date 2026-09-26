import { Listing, type SearchParams } from "@/components/listing";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  return (
    <>
      <form action="/search" className="container-page pt-4 md:hidden">
        <input name="q" defaultValue={q} placeholder="Search products…" className="h-12 w-full rounded-xl border border-gray-300 bg-white px-4" autoFocus={!q} />
      </form>
      <Listing basePath="/search" fixed={{}} searchParams={sp} title={q ? `Results for “${q}”` : "All products"} />
    </>
  );
}
