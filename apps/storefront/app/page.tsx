import Link from "next/link";
import { ArrowRight, Cpu, MessageCircle, ShieldCheck, Shirt, Smartphone, Truck } from "lucide-react";
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
  const bySlug = (slug: string) => categories.find((c) => c.slug === slug);
  const fashion = bySlug("fashion");
  const fashionLinks = fashion ? categories.filter((c) => c.parentId === fashion.id).slice(0, 3) : [];
  const phoneLinks = ["chargers-adapters", "cables", "cases", "earphones-headsets", "screen-protectors"]
    .map(bySlug)
    .filter((c): c is Category => Boolean(c));
  const techLinks = ["gadgets", "mice", "bluetooth-network-adapters"].map(bySlug).filter((c): c is Category => Boolean(c));
  return (
    <>
      <section className="container-page pt-8 md:pt-10">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div><div className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600">Shop your way</div><h1 className="mt-1 text-3xl font-black tracking-tight md:text-4xl">Explore our departments</h1></div>
          <Link href="/categories" className="hidden items-center gap-1 text-sm font-semibold text-brand-700 sm:inline-flex">See everything <ArrowRight className="size-4" /></Link>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <article className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-rose-100 via-pink-50 to-white p-5 shadow-sm ring-1 ring-rose-200/70">
            <div className="absolute -right-8 -top-8 size-32 rounded-full bg-rose-200/50" />
            <div className="relative"><div className="grid size-11 place-items-center rounded-2xl bg-white text-rose-700 shadow-sm"><Shirt className="size-5" /></div><h2 className="mt-6 text-2xl font-black text-rose-950">Fashion</h2><p className="mt-1 text-sm text-rose-900/65">Fresh looks for women, men and kids.</p>
              <div className="mt-5 flex flex-wrap gap-2">{fashionLinks.map((c) => <Link key={c.id} href={`/c/${c.slug}`} className="rounded-full bg-white/85 px-3 py-1.5 text-xs font-bold text-rose-900 shadow-sm">{c.name}</Link>)}</div>
              <Link href={fashion ? `/c/${fashion.slug}` : "/categories"} className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-rose-800">Shop fashion <ArrowRight className="size-4" /></Link>
            </div>
          </article>
          <article className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-100 via-cyan-50 to-white p-5 shadow-sm ring-1 ring-sky-200/70">
            <div className="absolute -right-8 -top-8 size-32 rounded-full bg-sky-200/60" />
            <div className="relative"><div className="grid size-11 place-items-center rounded-2xl bg-white text-sky-700 shadow-sm"><Smartphone className="size-5" /></div><h2 className="mt-6 text-2xl font-black text-sky-950">Phone accessories</h2><p className="mt-1 text-sm text-sky-900/65">Power, protect and connect your devices.</p>
              <div className="mt-5 flex flex-wrap gap-2">{phoneLinks.slice(0, 4).map((c) => <Link key={c.id} href={`/c/${c.slug}`} className="rounded-full bg-white/85 px-3 py-1.5 text-xs font-bold text-sky-900 shadow-sm">{c.name}</Link>)}</div>
              <Link href="/categories" className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-sky-800">Explore accessories <ArrowRight className="size-4" /></Link>
            </div>
          </article>
          <article className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-100 via-orange-50 to-white p-5 shadow-sm ring-1 ring-amber-200/70">
            <div className="absolute -right-8 -top-8 size-32 rounded-full bg-amber-200/60" />
            <div className="relative"><div className="grid size-11 place-items-center rounded-2xl bg-white text-amber-700 shadow-sm"><Cpu className="size-5" /></div><h2 className="mt-6 text-2xl font-black text-amber-950">Gadgets &amp; tech</h2><p className="mt-1 text-sm text-amber-900/65">Useful tech for work, home and travel.</p>
              <div className="mt-5 flex flex-wrap gap-2">{techLinks.map((c) => <Link key={c.id} href={`/c/${c.slug}`} className="rounded-full bg-white/85 px-3 py-1.5 text-xs font-bold text-amber-900 shadow-sm">{c.name}</Link>)}</div>
              <Link href={bySlug("gadgets") ? "/c/gadgets" : "/categories"} className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-amber-800">Shop gadgets <ArrowRight className="size-4" /></Link>
            </div>
          </article>
        </div>
      </section>

      <section className="container-page mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          { icon: Smartphone, t: "Mobile Money", d: "MTN & Airtel" },
          { icon: Truck, t: "48-hour delivery", d: "Across our service areas" },
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
