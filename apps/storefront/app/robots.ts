import type { MetadataRoute } from "next";
import { storefrontUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = storefrontUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/account/", "/checkout", "/cart", "/orders/", "/track", "/search", "/api/"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
