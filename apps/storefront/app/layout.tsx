import type { Metadata, Viewport } from "next";
import "./globals.css";
import { serverGet } from "@/lib/api";
import type { Category, ShopSettings } from "@/lib/types";
import { StoreProvider } from "@/components/providers";
import { BottomNav, Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Analytics } from "@/components/analytics";

export async function generateMetadata(): Promise<Metadata> {
  const s = await serverGet<ShopSettings>("/store/settings", { revalidate: 60 }).catch(() => null);
  const name = s?.shopName ?? "UG Mall";
  return {
    title: { default: `${name} — ${s?.tagline ?? "Online shopping in Uganda"}`, template: `%s | ${name}` },
    description: s?.heroSubtitle,
    metadataBase: new URL(process.env.STOREFRONT_URL ?? "http://localhost:3000"),
    applicationName: name,
    robots: { index: true, follow: true },
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
  return (
    <html lang="en-UG">
      <body>
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
