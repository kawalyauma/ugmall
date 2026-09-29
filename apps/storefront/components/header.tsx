"use client";

import Link from "next/link";
import { Heart, Home, LayoutGrid, MessageCircle, Search, ShoppingBag, User } from "lucide-react";
import { whatsappLink } from "@ugmall/shared";
import { useStore } from "./providers";
import { SearchBox } from "./search-box";
import type { Category } from "@/lib/types";

export function Header({ categories }: { categories: Category[] }) {
  const { settings, cart } = useStore();
  const top = categories.filter((c) => !c.parentId);

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
      {settings.announcement && (settings.whatsappNumber ? <a href={whatsappLink(settings.whatsappNumber, "Hi UG Mall, I need help with an order.")} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 bg-brand-700 px-4 py-1.5 text-center text-xs font-medium text-white hover:bg-brand-800"><MessageCircle className="size-3.5" /> {settings.announcement}</a> : <div className="bg-brand-700 px-4 py-1.5 text-center text-xs font-medium text-white">{settings.announcement}</div>)}
      <div className="container-page flex h-14 items-center gap-3">
        <Link href="/" className="shrink-0 text-lg font-extrabold tracking-tight text-brand-700">
          {settings.shopName}
        </Link>
        <SearchBox className="hidden flex-1 md:block" />
        <nav className="ml-auto flex items-center gap-1">
          <Link href="/search" className="rounded-full p-2 hover:bg-gray-100 md:hidden" aria-label="Search">
            <Search className="size-5" />
          </Link>
          <Link href="/account/wishlist" className="hidden rounded-full p-2 hover:bg-gray-100 md:block" aria-label="Wishlist">
            <Heart className="size-5" />
          </Link>
          <Link href="/account" className="hidden rounded-full p-2 hover:bg-gray-100 md:block" aria-label="Account">
            <User className="size-5" />
          </Link>
          <Link href="/cart" className="relative rounded-full p-2 hover:bg-gray-100" aria-label="Cart">
            <ShoppingBag className="size-5" />
            {cart.count > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid size-5 place-items-center rounded-full bg-accent text-[11px] font-bold text-white">{cart.count}</span>
            )}
          </Link>
        </nav>
      </div>
      <div className="container-page flex gap-2 overflow-x-auto pb-2 text-xs font-semibold text-gray-600 md:hidden">{top.slice(0, 6).map((c) => <Link key={c.id} href={`/c/${c.slug}`} className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5">{c.name}</Link>)}<Link href="/offers" className="shrink-0 rounded-full bg-amber-50 px-3 py-1.5 text-amber-800">Offers</Link></div>
      <div className="container-page hidden items-center gap-5 overflow-hidden pb-2 text-sm font-medium text-gray-600 md:flex">
        {top.slice(0, 8).map((c) => (
          <Link key={c.id} href={`/c/${c.slug}`} className="min-w-0 truncate hover:text-brand-700">
            {c.name}
          </Link>
        ))}
        <Link href="/categories" className="ml-auto shrink-0 font-semibold text-brand-700 hover:underline">
          All categories
        </Link>
        <Link href="/offers" className="text-accent hover:underline">
          Offers
        </Link>
      </div>
    </header>
  );
}

export function BottomNav() {
  const { cart } = useStore();
  const items = [
    { href: "/", label: "Home", icon: Home },
    { href: "/categories", label: "Categories", icon: LayoutGrid },
    { href: "/cart", label: "Cart", icon: ShoppingBag, badge: cart.count },
    { href: "/account/wishlist", label: "Wishlist", icon: Heart },
    { href: "/account", label: "Account", icon: User },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="grid grid-cols-5">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="relative flex flex-col items-center gap-0.5 py-2 text-[11px] text-gray-600 active:bg-gray-50">
            <i.icon className="size-5" />
            {i.label}
            {i.badge ? <span className="absolute right-[calc(50%-18px)] top-1 grid size-4 place-items-center rounded-full bg-accent text-[10px] font-bold text-white">{i.badge}</span> : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}
