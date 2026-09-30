import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverGet } from "@/lib/api";
import type { Category } from "@/lib/types";
import { Listing, type SearchParams } from "@/components/listing";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> };

async function getCategory(slug: string) {
  const cats = await serverGet<Category[]>("/store/categories");
  return cats.find((c) => c.slug === slug) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await getCategory((await params).slug);
  return c
    ? { title: c.name, description: c.description ?? `Shop ${c.name} online in Uganda.`, alternates: { canonical: `/c/${c.slug}` } }
    : { title: "Category not found", robots: { index: false, follow: false } };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const c = await getCategory(slug);
  if (!c) notFound();
  return <Listing basePath={`/c/${slug}`} fixed={{ category: slug }} searchParams={await searchParams} title={c.name} subtitle={c.description ?? undefined} />;
}
