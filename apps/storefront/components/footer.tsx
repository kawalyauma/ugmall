import Link from "next/link";
import { ArrowRight, Clock3, Mail, MapPin, MessageCircle, Phone, ShieldCheck, Truck } from "lucide-react";
import type { ShopSettings } from "@/lib/types";

export function Footer({ settings }: { settings: ShopSettings }) {
  const phoneHref = `tel:+${settings.whatsappNumber}`;
  return (
    <footer className="mt-14 overflow-hidden bg-[#082f2c] text-emerald-50">
      <div className="border-b border-white/10 bg-gradient-to-r from-brand-700 to-emerald-600">
        <div className="container-page flex flex-col gap-4 py-7 md:flex-row md:items-center md:justify-between">
          <div><div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-100">Need a hand choosing?</div><div className="mt-1 text-xl font-black">Chat with us and order on WhatsApp.</div></div>
          <a href={`https://wa.me/${settings.whatsappNumber}?text=${encodeURIComponent("Hello, I'd like help placing an order")}`} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-brand-800 shadow-lg transition hover:-translate-y-0.5">
            <MessageCircle className="size-4" /> Start a chat <ArrowRight className="size-4" />
          </a>
        </div>
      </div>
      <div className="container-page grid gap-9 py-10 text-sm text-emerald-100/80 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
        <div>
          <div className="text-2xl font-black tracking-tight text-white">{settings.shopName}</div>
          <p className="mt-3 max-w-xs leading-6">{settings.tagline}. Thoughtful service, secure payments and dependable delivery across Uganda.</p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-emerald-50"><ShieldCheck className="size-4 text-emerald-300" /> Shop confidently</div>
        </div>
        <div>
          <div className="font-bold text-white">Contact us</div>
          <div className="mt-4 space-y-3">
            <a href={phoneHref} className="flex items-center gap-2 hover:text-white"><Phone className="size-4 text-emerald-300" /> {settings.supportPhone}</a>
            <a href={`https://wa.me/${settings.whatsappNumber}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-white"><MessageCircle className="size-4 text-emerald-300" /> WhatsApp chat</a>
            {settings.supportEmail && !settings.supportEmail.includes("example.") && <a href={`mailto:${settings.supportEmail}`} className="flex items-center gap-2 hover:text-white"><Mail className="size-4 text-emerald-300" /> {settings.supportEmail}</a>}
          </div>
        </div>
        <div>
          <div className="font-bold text-white">Delivery</div>
          <div className="mt-4 space-y-3 leading-5">
            <p className="flex gap-2"><Truck className="mt-0.5 size-4 shrink-0 text-emerald-300" /><span>Delivery within 48 hours across our service areas.</span></p>
            <p className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-emerald-300" /><span>Kampala by boda; upcountry by courier or bus parcel.</span></p>
            <p className="flex gap-2"><Clock3 className="mt-0.5 size-4 shrink-0 text-emerald-300" /><span>{settings.businessHours}</span></p>
          </div>
        </div>
        <div>
          <div className="font-bold text-white">Quick links</div>
          <ul className="mt-4 space-y-3">
            <li><Link href="/categories" className="hover:text-white">Browse categories</Link></li>
            <li><Link href="/track" className="hover:text-white">Track your order</Link></li>
            <li><Link href="/help" className="hover:text-white">Delivery, payments &amp; returns</Link></li>
          </ul>
          <p className="mt-5 border-t border-white/10 pt-4 text-xs leading-5">
            We accept MTN Mobile Money and Airtel Money{settings.codMaxOrderTotal ? `, and Cash on Delivery for orders up to UGX ${settings.codMaxOrderTotal.toLocaleString("en-US")}` : " and Cash on Delivery"}.
          </p>
        </div>
      </div>
      <div className="border-t border-white/10 py-4 text-center text-xs text-emerald-100/50">
        © {new Date().getFullYear()} {settings.shopName}. Proudly serving Uganda 🇺🇬
      </div>
    </footer>
  );
}
