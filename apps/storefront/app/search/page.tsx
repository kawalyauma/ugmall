import { Listing, type SearchParams } from "@/components/listing";
import { SearchBox } from "@/components/search-box";
import { serverGet } from "@/lib/api";

export const metadata = { title: "Search", robots: { index: false, follow: true } };

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const brandSlug = typeof sp.brand === "string" ? sp.brand : "";
  const brand = brandSlug ? (await serverGet<{ name: string; slug: string }[]>("/store/brands", { revalidate: 300 }).catch(() => [])).find((b) => b.slug === brandSlug) : undefined;
  const title = q ? `Results for “${q}”${brand ? ` in ${brand.name}` : ""}` : brand ? brand.name : "All products";
  return (
    <>
      <div className="container-page pt-4 md:hidden">
        <SearchBox key={q} defaultValue={q} autoFocus={!q && !brand} inputClassName="h-12 rounded-xl bg-white text-base" />
      </div>
      <Listing basePath="/search" fixed={{}} searchParams={sp} title={title} />
    </>
  );
}
