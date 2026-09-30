import type { Metadata, Viewport } from "next";
import { Outfit, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { serverGet } from "@/lib/api";
import type { Category, ShopSettings } from "@/lib/types";
import { StoreProvider } from "@/components/providers";
import { BottomNav, Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Analytics } from "@/components/analytics";
import { storefrontUrl } from "@/lib/seo";

const body = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap", variable: "--font-body" });
const heading = Outfit({ subsets: ["latin"], display: "swap", variable: "--font-heading" });

export async function generateMetadata(): Promise<Metadata> {
  const s = await serverGet<ShopSettings>("/store/settings", { revalidate: 60 }).catch(() => null);
  const name = s?.shopName ?? "UG Mall";
  return {
    title: { default: `${name} — ${s?.tagline ?? "Online shopping in Uganda"}`, template: `%s | ${name}` },
    description: s?.heroSubtitle,
    metadataBase: new URL(storefrontUrl()),
    applicationName: name,
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
    openGraph: { type: "website", siteName: name, locale: "en_UG", title: name, description: s?.heroSubtitle },
  };
}

// Render on request (data is cached per-fetch via `revalidate`), so builds never need a running API.
export const dynamic = "force-dynamic";

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f766e" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [settings, categories] = await Promise.all([
    serverGet<ShopSettings>("/store/settings", { revalidate: 60 }),
    serverGet<Category[]>("/store/categories", { revalidate: 60 }).catch(() => []),
  ]);
  const base = storefrontUrl();
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "OnlineStore",
        "@id": `${base}/#store`,
        name: settings.shopName,
        url: base,
        description: settings.tagline,
        email: settings.supportEmail || undefined,
        telephone: settings.supportPhone || undefined,
        address: settings.pickupAddress ? { "@type": "PostalAddress", streetAddress: settings.pickupAddress, addressCountry: "UG" } : undefined,
        sameAs: [settings.socialFacebook, settings.socialInstagram, settings.socialTiktok].filter(Boolean),
      },
      {
        "@type": "WebSite",
        "@id": `${base}/#website`,
        url: base,
        name: settings.shopName,
        publisher: { "@id": `${base}/#store` },
        inLanguage: "en-UG",
      },
    ],
  };
  return (
    <html lang="en-UG" className={`${body.variable} ${heading.variable}`}>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
        <StoreProvider settings={settings}>
          <Header categories={categories} />
          <main className="pb-safe min-h-[60vh]">{children}</main>
          <Footer settings={settings} />
          <BottomNav />
          <Analytics />
        </StoreProvider>
      </body>
    </html>
  );
}
