import Link from "next/link";
import { ArrowRight, Clock3, MessageCircle, ShieldCheck, Smartphone, Sparkles, Truck } from "lucide-react";
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
  const categoryStyles = [
    "from-teal-50 to-emerald-100 text-teal-900",
    "from-amber-50 to-orange-100 text-amber-950",
    "from-sky-50 to-cyan-100 text-sky-950",
    "from-rose-50 to-pink-100 text-rose-950",
  ];
  return (
    <>
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-800 via-brand-700 to-emerald-500 text-white">
        <div className="absolute -right-20 -top-32 size-80 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-28 left-1/3 size-72 rounded-full bg-amber-300/20 blur-3xl" />
        <div className="container-page relative grid gap-8 py-12 md:grid-cols-[1.4fr_0.6fr] md:items-center md:py-20">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-50 backdrop-blur">
              <Sparkles className="size-3.5" /> Style, value, delivered
            </div>
            <h1 className="max-w-2xl text-4xl font-black leading-[1.05] tracking-tight md:text-6xl">{settings.heroTitle}</h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-emerald-50 md:text-lg">{settings.heroSubtitle}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/categories" className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-brand-800 shadow-lg shadow-emerald-950/15 transition hover:-translate-y-0.5">
                Browse collections <ArrowRight className="size-4" />
              </Link>
              <a href={`https://wa.me/${settings.whatsappNumber}?text=${encodeURIComponent("Hello, I'd like to place an order")}`} className="inline-flex items-center gap-2 rounded-xl bg-whatsapp px-5 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-950/15 transition hover:-translate-y-0.5 hover:brightness-105" target="_blank" rel="noreferrer">
                <MessageCircle className="size-4" /> Chat on WhatsApp
              </a>
            </div>
          </div>
          <div className="hidden rounded-3xl border border-white/20 bg-white/10 p-5 shadow-2xl backdrop-blur md:block">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-2xl bg-white text-brand-700"><Clock3 className="size-5" /></div>
              <div><div className="text-xs uppercase tracking-widest text-emerald-100">Delivery promise</div><div className="font-bold">Delivered within 48 hours</div></div>
            </div>
            <div className="mt-5 border-t border-white/15 pt-4 text-sm leading-6 text-emerald-50">Shop online or message us directly. We keep every order simple, secure and easy to track.</div>
          </div>
        </div>
      </section>

      <section className="container-page -mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
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

      {top.length > 0 && <section className="container-page mt-10">
        <div className="mb-4 flex items-end justify-between">
          <div><div className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600">Find your style</div><h2 className="mt-1 text-2xl font-black tracking-tight">Browse by category</h2></div>
          <Link href="/categories" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700">View all <ArrowRight className="size-4" /></Link>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {top.slice(0, 8).map((c, index) => (
            <Link key={c.id} href={`/c/${c.slug}`} className={`group relative min-h-36 overflow-hidden rounded-3xl bg-gradient-to-br p-4 shadow-sm ring-1 ring-black/5 transition hover:-translate-y-1 hover:shadow-xl ${categoryStyles[index % categoryStyles.length]}`}>
              {c.image && <img src={c.image} alt="" className="absolute inset-0 size-full object-cover opacity-25 transition duration-500 group-hover:scale-105" />}
              <div className="absolute -bottom-8 -right-8 size-28 rounded-full bg-white/40" />
              <div className="relative flex h-full flex-col justify-between">
                <span className="grid size-11 place-items-center rounded-2xl bg-white/75 text-xl font-black shadow-sm">{c.name[0]}</span>
                <div className="flex items-end justify-between gap-2"><span className="text-lg font-black">{c.name}</span><span className="grid size-8 place-items-center rounded-full bg-white/80 transition group-hover:translate-x-0.5"><ArrowRight className="size-4" /></span></div>
              </div>
            </Link>
          ))}
        </div>
      </section>}

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
