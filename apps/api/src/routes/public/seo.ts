import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { AppEnv } from "../../types";

export const seoRoutes = new Hono<AppEnv>();

seoRoutes.get("/sitemap", async (c) => {
  const { db } = c.get("container");
  const [categories, products, offers, deals] = await Promise.all([
    db.execute<{ slug: string; updatedAt: Date; image: string | null }>(sql`
      select c.slug, c.updated_at as "updatedAt", m.public_url as image
      from categories c
      left join media_files m on m.id = c.image_id
      where c.is_active = true
      order by c.updated_at desc
    `),
    db.execute<{ slug: string; updatedAt: Date; image: string | null }>(sql`
      select p.slug, p.updated_at as "updatedAt",
        (select coalesce(m.variants->'large'->>'url', m.variants->'medium'->>'url', m.public_url)
         from product_images pi
         join media_files m on m.id = pi.media_id
         where pi.product_id = p.id
         order by pi.sort_order, pi.created_at
         limit 1) as image
      from products p
      where p.status = 'active'
      order by p.updated_at desc
    `),
    db.execute<{ slug: string; createdAt: Date; image: string | null }>(sql`
      select p.slug, p.created_at as "createdAt", m.public_url as image
      from promotions p
      left join media_files m on m.id = p.banner_id
      where p.is_active = true
        and (p.starts_at is null or p.starts_at <= now())
        and (p.ends_at is null or p.ends_at > now())
      order by p.created_at desc
    `),
    db.execute<{ slug: string; createdAt: Date; image: string | null }>(sql`
      select d.slug, d.created_at as "createdAt", m.public_url as image
      from deals d
      left join media_files m on m.id = d.image_id
      where d.is_active = true
        and (d.starts_at is null or d.starts_at <= now())
        and (d.ends_at is null or d.ends_at > now())
      order by d.created_at desc
    `),
  ]);

  c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  return c.json({ categories, products, offers, deals });
});
