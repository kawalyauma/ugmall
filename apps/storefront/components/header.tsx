"use client";

import Link from "next/link";
import { Heart, HelpCircle, Home, LayoutGrid, MessageCircle, Search, ShoppingBag, User } from "lucide-react";
import { whatsappLink } from "@ugmall/shared";
import { useStore } from "./providers";
import { SearchBox } from "./search-box";
import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Header({ categories }: { categories: Category[] }) {
  const { settings, cart, cartBump } = useStore();
  const top = categories.filter((c) => !c.parentId);

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
      {settings.announcement && (settings.whatsappNumber ? <a href={whatsappLink(settings.whatsappNumber, "Hi UG Mall, I need help with an order.")} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 bg-brand-700 px-4 py-1.5 text-center text-xs font-medium text-white hover:bg-brand-800"><MessageCircle className="size-3.5" /> {settings.announcement}</a> : <div className="bg-brand-700 px-4 py-1.5 text-center text-xs font-medium text-white">{settings.announcement}</div>)}
      <div className="container-page flex h-16 items-center gap-3 md:gap-5">
        <Link href="/" className="shrink-0 text-xl font-black tracking-tight text-brand-700 md:text-2xl">
          {settings.shopName}
        </Link>
        <SearchBox className="hidden max-w-2xl flex-1 md:block" />
        <nav className="ml-auto flex items-center gap-1">
          <Link href="/search" className="rounded-full p-2 hover:bg-gray-100 md:hidden" aria-label="Search">
            <Search className="size-5" />
          </Link>
          <Link href="/account/wishlist" className="hidden rounded-xl p-2 hover:bg-gray-100 lg:block" aria-label="Wishlist">
            <Heart className="size-5" />
          </Link>
          {settings.whatsappNumber && <a href={whatsappLink(settings.whatsappNumber, "Hi UG Mall, I need help shopping.")} target="_blank" rel="noreferrer" className="hidden items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-bold hover:bg-gray-100 lg:flex"><HelpCircle className="size-5" /> Help</a>}
          <Link href="/account" className="hidden items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-bold hover:bg-gray-100 md:flex" aria-label="Account">
            <User className="size-5" /> <span className="hidden lg:inline">Account</span>
          </Link>
          <Link href="/cart" className="relative flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-bold hover:bg-gray-100" aria-label="Cart">
            <ShoppingBag className="size-5" />
            <span className="hidden lg:inline">Cart</span>
            {cart.count > 0 && (
              <span key={cartBump} className={cn("absolute -right-0.5 -top-0.5 grid size-5 place-items-center rounded-full bg-accent text-[11px] font-bold text-white", cartBump > 0 && "animate-pop")}>{cart.count}</span>
            )}
          </Link>
        </nav>
      </div>
      <div className="container-page flex gap-2 overflow-x-auto pb-2 text-xs font-semibold text-gray-600 md:hidden">{top.slice(0, 6).map((c) => <Link key={c.id} href={`/c/${c.slug}`} className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5">{c.name}</Link>)}<Link href="/offers" className="shrink-0 rounded-full bg-amber-50 px-3 py-1.5 text-amber-800">Offers</Link></div>
      <div className="container-page hidden h-10 items-center gap-6 overflow-hidden border-t border-gray-100 text-sm font-semibold text-gray-700 md:flex">
        <Link href="/categories" className="flex shrink-0 items-center gap-1.5 font-extrabold text-brand-800"><LayoutGrid className="size-4" /> Categories</Link>
        {top.slice(0, 8).map((c) => (
          <Link key={c.id} href={`/c/${c.slug}`} className="min-w-0 truncate hover:text-brand-700">
            {c.name}
          </Link>
        ))}
        <Link href="/offers" className="ml-auto shrink-0 text-accent hover:underline">
          Deals
        </Link>
      </div>
    </header>
  );
}

export function BottomNav() {
  const { cart, cartBump } = useStore();
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
            {i.badge ? <span key={cartBump} className={cn("absolute right-[calc(50%-18px)] top-1 grid size-4 place-items-center rounded-full bg-accent text-[10px] font-bold text-white", cartBump > 0 && "animate-pop")}>{i.badge}</span> : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}
