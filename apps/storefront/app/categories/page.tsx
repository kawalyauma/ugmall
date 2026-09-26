import Link from "next/link";
import { ArrowRight, LayoutGrid } from "lucide-react";
import { serverGet } from "@/lib/api";
import type { Category } from "@/lib/types";

export const metadata = { title: "Categories" };

export default async function Categories() {
  const cats = await serverGet<Category[]>("/store/categories");
  const top = cats.filter((c) => !c.parentId);
  const styles = ["from-teal-50 to-emerald-100", "from-amber-50 to-orange-100", "from-sky-50 to-cyan-100", "from-rose-50 to-pink-100"];
  return (
    <div className="container-page py-8 md:py-12">
      <div className="mb-8 max-w-2xl">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-brand-100 px-3 py-1 text-xs font-bold uppercase tracking-widest text-brand-800"><LayoutGrid className="size-3.5" /> Collections</div>
        <h1 className="text-3xl font-black tracking-tight md:text-4xl">Browse every category</h1>
        <p className="mt-2 text-gray-600">Find your next favourite piece, then order online or chat with us on WhatsApp.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {top.map((c, index) => {
          const children = cats.filter((x) => x.parentId === c.id);
          return (
            <div key={c.id} className={`relative overflow-hidden rounded-3xl bg-gradient-to-br p-5 shadow-sm ring-1 ring-black/5 ${styles[index % styles.length]}`}>
              {c.image && <img src={c.image} alt="" className="absolute inset-0 size-full object-cover opacity-15" />}
              <Link href={`/c/${c.slug}`} className="relative flex items-center justify-between text-xl font-black">
                {c.name} <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1.5 text-xs font-bold text-brand-800">Shop all <ArrowRight className="size-3.5" /></span>
              </Link>
              {children.length > 0 && (
                <div className="relative mt-5 flex flex-wrap gap-2">
                  {children.map((ch) => (
                    <Link key={ch.id} href={`/c/${ch.slug}`} className="rounded-full bg-white/75 px-3 py-1.5 text-sm font-medium shadow-sm transition hover:bg-white">
                      {ch.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {top.length === 0 && (
          <div className="rounded-3xl border border-dashed border-brand-200 bg-gradient-to-br from-brand-50 to-white p-10 text-center md:col-span-2">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-white text-brand-700 shadow-sm"><LayoutGrid className="size-6" /></div>
            <h2 className="mt-4 text-xl font-black">New collections are on the way</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-gray-600">We’re curating the catalogue. Chat with us on WhatsApp if you already know what you’re looking for.</p>
          </div>
        )}
      </div>
    </div>
  );
}
