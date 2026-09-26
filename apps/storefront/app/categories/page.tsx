import Link from "next/link";
import { ArrowRight, ChevronRight, FolderTree, Layers3 } from "lucide-react";
import { serverGet } from "@/lib/api";
import type { Category } from "@/lib/types";

export const metadata = { title: "Categories" };

function CategoryChildren({ parentId, categories, depth = 0 }: { parentId: string; categories: Category[]; depth?: number }) {
  const children = categories.filter((category) => category.parentId === parentId);
  if (!children.length) return null;
  return (
    <ul className={`${depth ? "mt-1.5" : "mt-3"} space-y-1 border-l border-gray-200 pl-3`}>
      {children.map((category) => {
        const childCount = categories.filter((candidate) => candidate.parentId === category.id).length;
        if (childCount > 0) {
          return (
            <li key={category.id}>
              <details className="group/tree rounded-xl open:bg-gray-50">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-gray-700 transition hover:bg-brand-50 hover:text-brand-800 [&::-webkit-details-marker]:hidden">
                  <span className="grid size-5 shrink-0 place-items-center rounded-md bg-gray-100 text-gray-500 transition group-open/tree:bg-brand-100 group-open/tree:text-brand-700">
                    <ChevronRight className="size-3.5 transition group-open/tree:rotate-90" />
                  </span>
                  <span className="font-semibold">{category.name}</span>
                  <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-gray-500 shadow-sm ring-1 ring-gray-100">{childCount}</span>
                </summary>
                <div className="pb-2 pl-3 pr-2">
                  <Link href={`/c/${category.slug}`} className="ml-3 inline-flex items-center gap-1 py-2 text-xs font-bold text-brand-700 hover:text-brand-900">
                    Shop all {category.name} <ArrowRight className="size-3.5" />
                  </Link>
                  <CategoryChildren parentId={category.id} categories={categories} depth={depth + 1} />
                </div>
              </details>
            </li>
          );
        }
        return (
          <li key={category.id}>
            <Link href={`/c/${category.slug}`} className="group flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-gray-700 transition hover:bg-brand-50 hover:text-brand-800">
              <span className="grid size-5 shrink-0 place-items-center rounded-md bg-gray-50 text-gray-400 transition group-hover:bg-brand-100 group-hover:text-brand-700"><ChevronRight className="size-3.5 transition group-hover:translate-x-0.5" /></span>
              <span className="font-semibold">{category.name}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default async function Categories() {
  const categories = await serverGet<Category[]>("/store/categories");
  const roots = categories.filter((category) => !category.parentId);
  return (
    <div className="container-page py-8 md:py-12">
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm md:flex md:items-end md:justify-between md:p-8">
        <div className="max-w-2xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-brand-100 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-brand-800"><FolderTree className="size-3.5" /> Catalogue directory</div>
          <h1 className="text-3xl font-black tracking-tight md:text-4xl">Shop by category</h1>
          <p className="mt-2 leading-6 text-gray-600">Explore the full catalogue from departments down to each specialised collection.</p>
        </div>
        <div className="mt-5 flex items-center gap-3 rounded-2xl bg-gray-50 px-4 py-3 md:mt-0">
          <div className="grid size-10 place-items-center rounded-xl bg-white text-brand-700 shadow-sm"><Layers3 className="size-5" /></div>
          <div><div className="text-2xl font-black">{categories.length}</div><div className="text-xs text-gray-500">active categories</div></div>
        </div>
      </div>

      <div className="mt-6 grid items-start gap-4 md:grid-cols-2">
        {roots.map((category) => {
          const childCount = categories.filter((candidate) => candidate.parentId === category.id).length;
          return (
            <section key={category.id} className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm transition hover:border-brand-200 hover:shadow-md">
              <div className="flex items-center gap-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white p-5">
                <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-brand-100 text-xl font-black text-brand-800">
                  {category.image ? <img src={category.image} alt="" className="size-full object-cover" /> : category.name[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/c/${category.slug}`} className="text-xl font-black tracking-tight text-gray-900 hover:text-brand-700">{category.name}</Link>
                  <p className="mt-1 line-clamp-2 text-sm text-gray-500">{category.description || (childCount ? `${childCount} collections` : "Browse all products in this category")}</p>
                </div>
                <Link href={`/c/${category.slug}`} aria-label={`Shop all ${category.name}`} className="grid size-9 shrink-0 place-items-center rounded-full border border-gray-200 bg-white text-brand-700 transition hover:border-brand-300 hover:bg-brand-50"><ArrowRight className="size-4" /></Link>
              </div>
              <div className="p-5">
                {childCount > 0 ? <CategoryChildren parentId={category.id} categories={categories} /> : <Link href={`/c/${category.slug}`} className="inline-flex items-center gap-1 text-sm font-bold text-brand-700">View products <ArrowRight className="size-4" /></Link>}
              </div>
            </section>
          );
        })}
        {roots.length === 0 && (
          <div className="rounded-3xl border border-dashed border-gray-300 bg-white p-12 text-center md:col-span-2">
            <FolderTree className="mx-auto size-8 text-gray-300" />
            <h2 className="mt-4 text-lg font-bold">The catalogue is being organised</h2>
            <p className="mt-1 text-sm text-gray-500">Categories will appear here once they are available.</p>
          </div>
        )}
      </div>
    </div>
  );
}
