import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.STOREFRONT_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/account", "/checkout", "/cart", "/orders"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
