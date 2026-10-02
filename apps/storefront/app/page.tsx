import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgePercent,
  Baby,
  Clock3,
  Flame,
  Headphones,
  House,
  Laptop,
  LayoutGrid,
  MessageCircle,
  ShieldCheck,
  Shirt,
  Smartphone,
  Sparkles,
  Store,
  Truck,
  Tv,
  Zap,
} from "lucide-react";
import { whatsappLink } from "@ugmall/shared";
import { serverGet } from "@/lib/api";
import type { Category, ProductCard as Product, ShopSettings } from "@/lib/types";
import { ProductCard } from "@/components/product-card";
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

const categoryIcon = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes("phone") || n.includes("mobile")) return Smartphone;
  if (n.includes("television") || n.includes("tv")) return Tv;
  if (n.includes("computer") || n.includes("laptop")) return Laptop;
  if (n.includes("home") || n.includes("appliance")) return House;
  if (n.includes("fashion") || n.includes("cloth")) return Shirt;
  if (n.includes("baby") || n.includes("kid")) return Baby;
  if (n.includes("audio") || n.includes("earphone") || n.includes("headset")) return Headphones;
  return LayoutGrid;
};

function MarketProductRail({ items }: { items: Product[] }) {
  return (
    <div className="-mx-3 flex snap-x gap-2.5 overflow-x-auto px-3 pb-3 md:-mx-4 md:gap-3 md:px-4">
      {items.map((p) => (
        <div key={p.id} className="w-[10.25rem] shrink-0 snap-start sm:w-[11.5rem] lg:w-[12.25rem]">
          <ProductCard p={p} />
        </div>
      ))}
    </div>
  );
}

function MarketSection({
  title,
  subtitle,
  href,
  items,
  headerClass = "bg-white text-gray-900",
  icon: Icon,
}: {
  title: string;
  subtitle?: string;
  href: string;
  items: Product[];
  headerClass?: string;
  icon: typeof Smartphone;
}) {
  if (!items.length) return null;
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
      <div className={`flex min-h-14 items-center justify-between gap-3 px-4 py-3 ${headerClass}`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/20"><Icon className="size-5" /></span>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-black tracking-tight md:text-xl">{title}</h2>
            {subtitle && <p className="hidden truncate text-xs opacity-75 sm:block">{subtitle}</p>}
          </div>
        </div>
        <Link href={href} className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-extrabold uppercase tracking-wide hover:bg-black/5">
          See all <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <div className="px-3 pt-3 md:px-4 md:pt-4"><MarketProductRail items={items} /></div>
    </section>
  );
}

function QuickCategories({ categories }: { categories: Category[] }) {
  const preferred = ["mobile-phones", "televisions", "electronics", "home-office-appliances", "fashion", "beauty-personal-care", "baby-kids", "computing"];
  const top = categories.filter((c) => !c.parentId);
  const chosen = [
    ...preferred.map((slug) => top.find((c) => c.slug === slug)).filter(Boolean),
    ...top,
  ].filter((c, i, all): c is Category => Boolean(c) && all.findIndex((x) => x?.id === c?.id) === i).slice(0, 8);

  return (
    <section className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5 md:p-4">
      <div className="grid grid-cols-4 gap-2 md:grid-cols-8 md:gap-3">
        {chosen.map((c, i) => {
          const Icon = categoryIcon(c.name);
          const tints = ["bg-teal-50 text-teal-700", "bg-amber-50 text-amber-700", "bg-sky-50 text-sky-700", "bg-violet-50 text-violet-700"];
          return (
            <Link key={c.id} href={`/c/${c.slug}`} className="group min-w-0 text-center">
              <div className={`mx-auto grid aspect-square w-full max-w-24 place-items-center overflow-hidden rounded-xl ${tints[i % tints.length]} transition group-hover:-translate-y-0.5 group-hover:shadow-md`}>
                {c.image ? <img src={c.image} alt="" loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-105" /> : <Icon className="size-8 md:size-10" />}
              </div>
              <div className="mt-1.5 line-clamp-2 text-[11px] font-bold leading-4 text-gray-800 md:text-xs">{c.name}</div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function FlashSale({ offers, items, total }: { offers: Offer[]; items: Product[]; total: number }) {
  if (!items.length) return null;
  const lead = offers[0];
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
      <div className="flex min-h-16 items-center justify-between gap-3 bg-gradient-to-r from-brand-800 via-brand-700 to-emerald-600 px-4 py-3 text-white">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/15"><Zap className="size-5 fill-current" /></span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-xl font-black tracking-tight">Flash Deals</h2>
              {lead?.endsAt && <Countdown endsAt={lead.endsAt} className="hidden rounded-md bg-black/15 px-2 py-1 text-xs sm:block" />}
            </div>
            <p className="truncate text-xs text-emerald-50">{lead?.description ?? `${total} special-price products available now`}</p>
          </div>
        </div>
        <Link href="/offers" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-brand-800 shadow-sm">
          See all <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <div className="px-3 pt-3 md:px-4 md:pt-4"><MarketProductRail items={items} /></div>
    </section>
  );
}

export default async function Home() {
  const [settings, categories, featured, newest, trending, smartphones, televisions, offers, onPromotion, deals] = await Promise.all([
    serverGet<ShopSettings>("/store/settings"),
    serverGet<Category[]>("/store/categories", { revalidate: 120 }).catch(() => []),
    serverGet<{ items: Product[] }>("/store/products?featured=1&sort=popular&limit=10"),
    serverGet<{ items: Product[] }>("/store/products?sort=newest&limit=10"),
    serverGet<{ items: Product[] }>("/store/products?sort=popular&limit=10"),
    serverGet<{ items: Product[] }>("/store/products?categories=smartphones,mobile-phones&sort=newest&limit=10"),
    serverGet<{ items: Product[] }>("/store/products?category=televisions&sort=newest&limit=10"),
    serverGet<Offer[]>("/store/offers").catch(() => []),
    serverGet<{ items: Product[]; total: number }>("/store/products?sale=1&sort=popular&limit=10").catch(() => ({ items: [], total: 0 })),
    serverGet<DealSlide[]>("/store/deals").catch(() => []),
  ]);

  return (
    <div className="bg-[#f3f5f5] pb-10">
      <div className="container-page space-y-4 pt-4 md:space-y-5">
        {deals.length > 0 ? (
          <DealsCarousel slides={deals} />
        ) : (
          <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-900 via-brand-700 to-emerald-500 px-6 py-10 text-white shadow-sm md:px-10 md:py-14">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-widest"><Store className="size-4" /> Shop Uganda</div>
              <h1 className="text-4xl font-black leading-none tracking-tight md:text-6xl">{settings.heroTitle}</h1>
              <p className="mt-4 max-w-xl text-sm text-emerald-50 md:text-base">{settings.heroSubtitle}</p>
              <Link href="/search" className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-extrabold text-gray-950 shadow-lg">Start shopping <ArrowRight className="size-4" /></Link>
            </div>
          </section>
        )}

        <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {[
            { icon: Smartphone, title: "Mobile Money", text: "Ssentezo · MTN & Airtel" },
            { icon: Truck, title: "Fast delivery", text: "Across Uganda" },
            { icon: ShieldCheck, title: "Secure checkout", text: "PesaPal cards in-app" },
            { icon: MessageCircle, title: "WhatsApp help", text: settings.supportPhone, href: settings.whatsappNumber ? whatsappLink(settings.whatsappNumber, "Hi UG Mall, I need help shopping.") : undefined },
          ].map((item) => {
            const content = <><span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700"><item.icon className="size-5" /></span><span className="min-w-0"><span className="block truncate text-sm font-extrabold">{item.title}</span><span className="block truncate text-[11px] text-gray-500">{item.text}</span></span></>;
            return item.href ? <a key={item.title} href={item.href} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5 hover:ring-brand-200">{content}</a> : <div key={item.title} className="flex items-center gap-2.5 rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5">{content}</div>;
          })}
        </section>

        <QuickCategories categories={categories} />
        <FlashSale offers={offers} items={onPromotion.items} total={onPromotion.total} />

        <MarketSection title="Recommended for you" subtitle="Popular products shoppers are choosing now" href="/search?sort=popular" items={trending.items} icon={Sparkles} headerClass="bg-amber-100 text-amber-950" />
        <MarketSection title="Phones & smart tech" subtitle="Samsung, Tecno, Infinix, itel, Xiaomi and more" href="/c/smartphones" items={smartphones.items} icon={Smartphone} headerClass="bg-gradient-to-r from-brand-800 to-brand-600 text-white" />
        <MarketSection title="TVs & home entertainment" subtitle="Smart, QLED and 4K televisions for every room" href="/c/televisions" items={televisions.items} icon={Tv} headerClass="bg-gradient-to-r from-slate-900 to-slate-700 text-white" />
        <MarketSection title="Featured picks" subtitle="Strong value, availability and customer interest" href="/search?featured=1" items={featured.items} icon={BadgePercent} headerClass="bg-emerald-100 text-emerald-950" />
        <MarketSection title="New arrivals" subtitle="The latest products added to UG Mall" href="/search?sort=newest" items={newest.items} icon={Flame} headerClass="bg-orange-100 text-orange-950" />

        <section className="grid gap-3 md:grid-cols-3">
          {[
            { icon: Clock3, title: "Order any time", text: "Shop online 24/7 and track your order from checkout to delivery." },
            { icon: ShieldCheck, title: "Trusted payments", text: "Pay securely with mobile money, card, pickup or eligible cash on delivery." },
            { icon: Truck, title: "Made for Uganda", text: "Clear UGX pricing, local support and delivery coverage across the country." },
          ].map((item) => <div key={item.title} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5"><item.icon className="size-7 text-brand-700" /><h2 className="mt-3 text-lg font-black">{item.title}</h2><p className="mt-1 text-sm leading-6 text-gray-600">{item.text}</p></div>)}
        </section>
      </div>
      <RecentlyViewedSection />
    </div>
  );
}
