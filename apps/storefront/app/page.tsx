import Link from "next/link";
import { ArrowRight, MessageCircle, ShieldCheck, Shirt, Smartphone, Truck, Zap } from "lucide-react";
import { serverGet } from "@/lib/api";
import type { ProductCard as Product, ShopSettings } from "@/lib/types";
import { ProductCard, ProductGrid } from "@/components/product-card";
import { Countdown } from "@/components/countdown";
import { DealsCarousel, type DealSlide } from "@/components/deals-carousel";
import { ForYouFeed, ForYouRows } from "@/components/recs";

interface Offer {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  percentOff: number | null;
  endsAt: string | null;
  banner: string | null;
}

export const revalidate = 30;

function ProductSection({ icon: Icon, eyebrow, title, description, href, items, accent }: {
  icon: typeof Shirt;
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  items: Product[];
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

/** Campaign strip straight under the header: the lead promotion plus everything currently discounted. */
function Campaign({ offers, items, total }: { offers: Offer[]; items: Product[]; total: number }) {
  if (!items.length) return null;
  const lead = offers[0];
  const bestDiscount = Math.max(...items.map((p) => p.discountPercent));
  return (
    <section className="container-page mt-4">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-orange-500 via-accent to-amber-400 shadow-sm">
        <Link href={lead ? `/offers/${lead.slug}` : "/offers"} className="relative flex flex-col gap-3 px-4 py-4 text-white md:flex-row md:items-center md:gap-6 md:px-6">
          {lead?.banner && <img src={lead.banner} alt="" className="absolute inset-0 size-full object-cover opacity-25" />}
          <div className="relative min-w-0 md:flex-1">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.16em]">
              <Zap className="size-3.5 fill-white" /> Campaign
            </div>
            <h2 className="mt-1 truncate text-2xl font-black tracking-tight md:text-3xl">{lead?.title ?? "Hot deals"}</h2>
            <p className="text-sm font-medium text-white/90">
              {lead?.description ?? `${total} products on promotion`}
              {bestDiscount > 0 && <> · up to <b>-{Math.max(bestDiscount, lead?.percentOff ?? 0)}%</b></>}
            </p>
          </div>
          <div className="relative flex items-center justify-between gap-3 md:justify-end">
            {lead?.endsAt && <Countdown endsAt={lead.endsAt} className="rounded-lg bg-black/20 px-3 py-1.5 text-sm" />}
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-4 py-2 text-sm font-bold text-orange-600 shadow-sm">
              Shop now <ArrowRight className="size-4" />
            </span>
          </div>
        </Link>
        <div className="bg-white/95 px-3 pb-3 pt-3 md:px-4">
          <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-1 md:-mx-4 md:px-4">
            {items.map((p) => (
              <div key={p.id} className="w-36 shrink-0 snap-start md:w-44">
                <ProductCard p={p} />
              </div>
            ))}
            <Link href="/offers" className="grid w-36 shrink-0 snap-start place-items-center rounded-2xl border border-dashed border-orange-300 bg-orange-50 p-4 text-center text-sm font-bold text-orange-700 md:w-44">
              <span>
                See all {total}
                <br />
                promotions <ArrowRight className="mx-auto mt-1 size-5" />
              </span>
            </Link>
          </div>
          {offers.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {offers.slice(1, 6).map((o) => (
                <Link key={o.id} href={`/offers/${o.slug}`} className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-800 hover:bg-orange-100">
                  {o.title}
                  {o.percentOff ? ` · -${o.percentOff}%` : ""}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default async function Home() {
  // Curated rows use the "foryou" order without a shopper: a crowd-driven mix of
  // trending, quality, new and discounted items that rotates every hour.
  const [settings, fashion, phoneAccessories, offers, onPromotion, deals] = await Promise.all([
    serverGet<ShopSettings>("/store/settings"),
    serverGet<{ items: Product[] }>("/store/products?category=fashion&sort=foryou&limit=8"),
    serverGet<{ items: Product[] }>("/store/products?categories=chargers-adapters,cables,cases,earphones-headsets,screen-protectors&sort=foryou&limit=8"),
    serverGet<Offer[]>("/store/offers").catch(() => []),
    serverGet<{ items: Product[]; total: number }>("/store/products?sale=1&sort=popular&limit=12").catch(() => ({ items: [], total: 0 })),
    serverGet<DealSlide[]>("/store/deals").catch(() => []),
  ]);
  return (
    <>
      <Campaign offers={offers} items={onPromotion.items} total={onPromotion.total} />

      {deals.length > 0 && (
        <div className="container-page mt-4">
          <DealsCarousel slides={deals} />
        </div>
      )}

      <section className="container-page mt-6 grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          { icon: Smartphone, t: "Mobile Money & cards", d: "MTN, Airtel, Visa, Mastercard" },
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

      <ForYouRows />

      <ProductSection icon={Shirt} eyebrow="Style edit" title="Fashion" description="Fresh fashion picks from across the catalogue." href="/c/fashion" items={fashion.items} accent="bg-rose-100 text-rose-800" />
      <ProductSection icon={Smartphone} eyebrow="Everyday tech" title="Phone accessories" description="Chargers, cables, cases, audio and device protection." href="/categories" items={phoneAccessories.items} accent="bg-sky-100 text-sky-800" />

      <ForYouFeed />
    </>
  );
}
