import Link from "next/link";
import { ArrowRight, Flame, MessageCircle, ShieldCheck, Shirt, Smartphone, Truck } from "lucide-react";
import { serverGet } from "@/lib/api";
import type { ProductCard, ShopSettings } from "@/lib/types";
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

function ProductSection({ icon: Icon, eyebrow, title, description, href, items, accent }: {
  icon: typeof Shirt;
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  items: ProductCard[];
  accent: string;
}) {
  return (
    <section className="container-page mt-10">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <div className={`mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] ${accent}`}><Icon className="size-3.5" /> {eyebrow}</div>
          <h2 className="text-2xl font-black tracking-tight md:text-3xl">{title}</h2>
          <p className="mt-1 text-sm text-gray-600">{description}</p>
        </div>
        <Link href={href} className="hidden shrink-0 items-center gap-1 text-sm font-bold text-brand-700 sm:inline-flex">View all <ArrowRight className="size-4" /></Link>
      </div>
      <ProductGrid items={items} />
    </section>
  );
}

export default async function Home() {
  const [settings, fashion, trending, phoneAccessories, offers] = await Promise.all([
    serverGet<ShopSettings>("/store/settings"),
    serverGet<{ items: ProductCard[] }>("/store/products?category=fashion&sort=newest&limit=8"),
    serverGet<{ items: ProductCard[] }>("/store/products?sort=popular&limit=8"),
    serverGet<{ items: ProductCard[] }>("/store/products?categories=chargers-adapters,cables,cases,earphones-headsets,screen-protectors&sort=popular&limit=8"),
    serverGet<Offer[]>("/store/offers").catch(() => []),
  ]);
  return (
    <>
      <section className="container-page mt-6 grid grid-cols-2 gap-2 md:grid-cols-4">
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
      <ProductSection icon={Shirt} eyebrow="Style edit" title="Fashion" description="Fresh fashion picks from across the catalogue." href="/c/fashion" items={fashion.items} accent="bg-rose-100 text-rose-800" />
      <ProductSection icon={Flame} eyebrow="Popular now" title="Trending items" description="The products shoppers are viewing and buying most." href="/search?sort=popular" items={trending.items} accent="bg-amber-100 text-amber-800" />
      <ProductSection icon={Smartphone} eyebrow="Everyday tech" title="Phone accessories" description="Chargers, cables, cases, audio and device protection." href="/categories" items={phoneAccessories.items} accent="bg-sky-100 text-sky-800" />
    </>
  );
}
