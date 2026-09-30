import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Crown, Flame, MessageCircle, ShieldCheck, Shirt, Smartphone, Sparkles, Tag, Truck, Wallet, Zap } from "lucide-react";
import { formatUGX, whatsappLink } from "@ugmall/shared";
import { serverGet } from "@/lib/api";
import type { Category, ProductCard as Product, ShopSettings } from "@/lib/types";
import { ProductCard, ProductGrid } from "@/components/product-card";
import { Countdown } from "@/components/countdown";
import { DealsCarousel, type DealSlide } from "@/components/deals-carousel";
import { RecentlyViewedSection } from "@/components/recently-viewed";

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
export const metadata: Metadata = { alternates: { canonical: "/" } };

function ProductSection({ icon: Icon, eyebrow, title, description, href, items, accent, tint }: {
  icon: typeof Shirt;
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  items: Product[];
  accent: string;
  /** Full-width coloured band behind the section, to break up the page. */
  tint?: string;
}) {
  if (!items.length) return null;
  const inner = (
    <>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <div className={`mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] ${accent}`}><Icon className="size-3.5" /> {eyebrow}</div>
          <h2 className="text-2xl font-black tracking-tight md:text-3xl">{title}</h2>
          <p className="mt-1 text-sm text-gray-600">{description}</p>
        </div>
        <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-brand-700">View all <ArrowRight className="size-4" /></Link>
      </div>
      <ProductGrid items={items} />
    </>
  );
  return tint ? (
    <section className={`mt-10 py-8 ${tint}`}>
      <div className="container-page">{inner}</div>
    </section>
  ) : (
    <section className="container-page mt-10">{inner}</section>
  );
}

/** Round picture buttons for the top-level categories, scrollable on phones. */
function CategoryCircles({ categories }: { categories: Category[] }) {
  const top = categories.filter((c) => !c.parentId).slice(0, 12);
  if (!top.length) return null;
  return (
    <section className="container-page mt-8">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">Browse faster</div>
          <h2 className="mt-1 text-2xl font-black tracking-tight">Shop by category</h2>
        </div>
        <Link href="/categories" className="text-sm font-bold text-brand-700">All categories →</Link>
      </div>
      <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-6 md:gap-5 md:px-0">
        {top.map((c) => (
          <Link key={c.id} href={`/c/${c.slug}`} className="group w-20 shrink-0 snap-start text-center md:w-auto">
            <div className="mx-auto aspect-square w-full rounded-full bg-gradient-to-br from-brand-500 via-emerald-400 to-accent p-[3px] shadow-sm transition group-hover:-translate-y-0.5 group-hover:shadow-md">
              <div className="grid size-full place-items-center overflow-hidden rounded-full bg-white">
                {c.image ? <img src={c.image} alt="" loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-110" /> : <Shirt className="size-7 text-brand-700" />}
              </div>
            </div>
            <div className="mt-2 line-clamp-2 text-xs font-bold leading-4 text-gray-800">{c.name}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}

const PRICE_BANDS = [
  { label: "Under", max: 20_000, icon: Tag, className: "from-emerald-500 to-teal-600" },
  { label: "Under", max: 50_000, icon: Wallet, className: "from-sky-500 to-indigo-600" },
  { label: "Under", max: 100_000, icon: Sparkles, className: "from-orange-500 to-rose-500" },
  { label: "Premium", min: 100_000, icon: Crown, className: "from-gray-800 to-gray-950" },
] as const;

/** Quick entry points by budget; each opens the popular listing with a price filter. */
function ShopByPrice() {
  return (
    <section className="container-page mt-10">
      <div className="mb-3">
        <div className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">Every budget</div>
        <h2 className="mt-1 text-2xl font-black tracking-tight">Shop by price</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {PRICE_BANDS.map((b) => {
          const href = "max" in b ? `/search?max=${b.max}&sort=popular` : `/search?min=${b.min}&sort=popular`;
          return (
            <Link
              key={href}
              href={href}
              className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${b.className} p-4 text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg`}
            >
              <b.icon className="absolute -right-3 -top-3 size-20 text-white/15 transition duration-300 group-hover:rotate-12 group-hover:scale-110" />
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-white/80">{b.label}</div>
              <div className="mt-1 text-xl font-black md:text-2xl">{"max" in b ? formatUGX(b.max) : `${formatUGX(b.min)}+`}</div>
              <div className="mt-3 inline-flex items-center gap-1 text-xs font-bold">
                Shop now <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/** Campaign strip straight under the header: the lead promotion plus everything currently discounted. */
function Campaign({ offers, items, total }: { offers: Offer[]; items: Product[]; total: number }) {
  if (!items.length) return null;
  const lead = offers[0];
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
              {lead?.description ?? `${total} products on promotion · prices shown below`}
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
  const [settings, categories, featured, newest, trending, phoneAccessories, offers, onPromotion, deals] = await Promise.all([
    serverGet<ShopSettings>("/store/settings"),
    serverGet<Category[]>("/store/categories", { revalidate: 120 }).catch(() => []),
    serverGet<{ items: Product[] }>("/store/products?featured=1&sort=popular&limit=8"),
    serverGet<{ items: Product[] }>("/store/products?sort=newest&limit=8"),
    serverGet<{ items: Product[] }>("/store/products?sort=popular&limit=8"),
    serverGet<{ items: Product[] }>("/store/products?categories=chargers-adapters,cables,cases,earphones-headsets,screen-protectors&sort=popular&limit=8"),
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
          { icon: Smartphone, t: "Mobile Money", d: "MTN & Airtel" },
          { icon: Truck, t: "48-hour delivery", d: "Across our service areas" },
          { icon: ShieldCheck, t: "Cash on Delivery", d: "Pay when it arrives" },
          { icon: MessageCircle, t: "WhatsApp support", d: settings.supportPhone, href: settings.whatsappNumber ? whatsappLink(settings.whatsappNumber, "Hi UG Mall, I need help shopping.") : undefined },
        ].map((f) => {
          const body = <><f.icon className="size-6 shrink-0 text-brand-700" /><div><div className="text-sm font-semibold">{f.t}</div><div className="text-xs text-gray-500">{f.d}</div></div></>;
          return f.href ? <a key={f.t} href={f.href} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm hover:border-brand-200">{body}</a> : <div key={f.t} className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">{body}</div>;
        })}
      </section>

      <CategoryCircles categories={categories} />
      <ShopByPrice />
      <ProductSection icon={Sparkles} eyebrow="Staff picks" title="Featured products" description="Products selected for value, availability and customer interest." href="/search?featured=1" items={featured.items} accent="bg-emerald-100 text-emerald-800" />
      <ProductSection icon={Flame} eyebrow="Best sellers" title="Popular right now" description="Products shoppers are buying most often." href="/search?sort=popular" items={trending.items} accent="bg-amber-100 text-amber-800" tint="bg-gradient-to-b from-amber-50 to-orange-50/40" />
      <ProductSection icon={Shirt} eyebrow="Just added" title="New arrivals" description="The newest products added to UG Mall." href="/search?sort=newest" items={newest.items} accent="bg-rose-100 text-rose-800" />
      <ProductSection icon={Smartphone} eyebrow="Everyday tech" title="Phone accessories" description="Chargers, cables, cases, audio and device protection." href="/categories" items={phoneAccessories.items} accent="bg-sky-100 text-sky-800" tint="bg-gradient-to-b from-sky-50 to-indigo-50/40" />
      <RecentlyViewedSection />
    </>
  );
}
