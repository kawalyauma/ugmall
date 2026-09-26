import Link from "next/link";
import { MessageCircle, ShieldCheck, Smartphone, Truck } from "lucide-react";
import { serverGet } from "@/lib/api";
import type { Category, ProductCard, ShopSettings } from "@/lib/types";
import { ProductGrid } from "@/components/product-card";

interface Offer {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  percentOff: number | null;
  banner: string | null;
}

export const revalidate = 30;

export default async function Home() {
  const [settings, categories, featured, latest, offers] = await Promise.all([
    serverGet<ShopSettings>("/store/settings"),
    serverGet<Category[]>("/store/categories"),
    serverGet<{ items: ProductCard[] }>("/store/products?featured=1&limit=8"),
    serverGet<{ items: ProductCard[] }>("/store/products?sort=newest&limit=8"),
    serverGet<Offer[]>("/store/offers").catch(() => []),
  ]);
  const top = categories.filter((c) => !c.parentId);
  return (
    <>
      <section className="bg-gradient-to-br from-brand-700 to-brand-800 text-white">
        <div className="container-page py-10 md:py-16">
          <h1 className="max-w-xl text-3xl font-extrabold leading-tight md:text-5xl">{settings.heroTitle}</h1>
          <p className="mt-3 max-w-lg text-brand-100">{settings.heroSubtitle}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/categories" className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-brand-800">
              Shop now
            </Link>
            <a href={`https://wa.me/${settings.whatsappNumber}?text=${encodeURIComponent("Hello, I'd like to place an order")}`} className="inline-flex items-center gap-2 rounded-xl bg-whatsapp px-5 py-3 text-sm font-semibold text-white" target="_blank" rel="noreferrer">
              <MessageCircle className="size-4" /> Order on WhatsApp
            </a>
          </div>
        </div>
      </section>

      <section className="container-page -mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          { icon: Smartphone, t: "Mobile Money", d: "MTN & Airtel" },
          { icon: Truck, t: "Fast delivery", d: "Boda, courier & bus" },
          { icon: ShieldCheck, t: "Cash on Delivery", d: "Pay when it arrives" },
          { icon: MessageCircle, t: "WhatsApp support", d: settings.supportPhone },
        ].map((f) => (
          <div key={f.t} className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
            <f.icon className="size-6 shrink-0 text-brand-700" />
            <div>
              <div className="text-sm font-semibold">{f.t}</div>
              <div className="text-xs text-gray-500">{f.d}</div>
            </div>
          </div>
        ))}
      </section>

      <section className="container-page mt-8">
        <h2 className="mb-3 text-lg font-bold">Shop by category</h2>
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
          {top.map((c) => (
            <Link key={c.id} href={`/c/${c.slug}`} className="w-24 shrink-0 text-center">
              <div className="mx-auto grid size-20 place-items-center overflow-hidden rounded-full bg-brand-100 text-2xl font-bold text-brand-700">
                {c.image ? <img src={c.image} alt="" className="size-full object-cover" /> : c.name[0]}
              </div>
              <div className="mt-1 text-sm font-medium">{c.name}</div>
            </Link>
          ))}
        </div>
      </section>

      {offers.length > 0 && (
        <section className="container-page mt-6 grid gap-3 md:grid-cols-2">
          {offers.slice(0, 2).map((o) => (
            <Link key={o.id} href={`/offers/${o.slug}`} className="relative overflow-hidden rounded-2xl bg-accent p-5 text-white">
              {o.banner && <img src={o.banner} alt="" className="absolute inset-0 size-full object-cover opacity-30" />}
              <div className="relative">
                {o.percentOff && <div className="text-3xl font-extrabold">-{o.percentOff}%</div>}
                <div className="text-lg font-bold">{o.title}</div>
                {o.description && <div className="text-sm opacity-90">{o.description}</div>}
              </div>
            </Link>
          ))}
        </section>
      )}

      {featured.items.length > 0 && (
        <section className="container-page mt-8">
          <h2 className="mb-3 text-lg font-bold">Featured</h2>
          <ProductGrid items={featured.items} />
        </section>
      )}
      <section className="container-page mt-8">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-lg font-bold">New arrivals</h2>
          <Link href="/search?sort=newest" className="text-sm text-brand-700">
            See all →
          </Link>
        </div>
        <ProductGrid items={latest.items} />
      </section>
    </>
  );
}
