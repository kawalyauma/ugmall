import Link from "next/link";
import type { ShopSettings } from "@/lib/types";

export function Footer({ settings }: { settings: ShopSettings }) {
  return (
    <footer className="mt-12 border-t border-gray-200 bg-white">
      <div className="container-page grid gap-8 py-10 text-sm text-gray-600 md:grid-cols-4">
        <div>
          <div className="text-lg font-bold text-brand-700">{settings.shopName}</div>
          <p className="mt-2">{settings.tagline}</p>
        </div>
        <div>
          <div className="font-semibold text-gray-900">Contact</div>
          <p className="mt-2">📞 {settings.supportPhone}</p>
          <p>
            💬{" "}
            <a className="text-brand-700 hover:underline" href={`https://wa.me/${settings.whatsappNumber}`} target="_blank" rel="noreferrer">
              Chat on WhatsApp
            </a>
          </p>
          <p>✉️ {settings.supportEmail}</p>
        </div>
        <div>
          <div className="font-semibold text-gray-900">Delivery</div>
          <p className="mt-2">We deliver to your door across Uganda — boda in Kampala, courier and bus parcel upcountry.</p>
          <p>{settings.businessHours}</p>
        </div>
        <div>
          <div className="font-semibold text-gray-900">Help</div>
          <ul className="mt-2 space-y-1">
            <li>
              <Link href="/track" className="hover:underline">
                Track your order
              </Link>
            </li>
            <li>
              <Link href="/help" className="hover:underline">
                Delivery, payment &amp; returns
              </Link>
            </li>
          </ul>
          <p className="mt-3 text-xs">
            We accept MTN Mobile Money and Airtel Money{settings.codMaxOrderTotal ? `, and Cash on Delivery for orders up to UGX ${settings.codMaxOrderTotal.toLocaleString("en-US")}` : " and Cash on Delivery"}.
          </p>
        </div>
      </div>
      <div className="border-t border-gray-100 py-4 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} {settings.shopName}. Made in Uganda 🇺🇬
      </div>
    </footer>
  );
}
