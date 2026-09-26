import Link from "next/link";
import { serverGet } from "@/lib/api";
import type { Category } from "@/lib/types";

export const metadata = { title: "Categories" };

export default async function Categories() {
  const cats = await serverGet<Category[]>("/store/categories");
  const top = cats.filter((c) => !c.parentId);
  return (
    <div className="container-page py-5">
      <h1 className="mb-4 text-2xl font-bold">Categories</h1>
      <div className="space-y-3">
        {top.map((c) => {
          const children = cats.filter((x) => x.parentId === c.id);
          return (
            <div key={c.id} className="rounded-2xl border border-gray-200 bg-white p-4">
              <Link href={`/c/${c.slug}`} className="flex items-center justify-between font-semibold">
                {c.name} <span className="text-sm text-brand-700">Shop all →</span>
              </Link>
              {children.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {children.map((ch) => (
                    <Link key={ch.id} href={`/c/${ch.slug}`} className="rounded-full bg-gray-100 px-3 py-1.5 text-sm">
                      {ch.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
