/**
 * Seeds a fresh database with roles, an owner account, delivery zones,
 * categories and a few sample products (including the size 30–48 jeans).
 * Idempotent: safe to run more than once.
 *
 *   SEED_ADMIN_EMAIL=owner@shop.ug SEED_ADMIN_PASSWORD='...' pnpm db:seed
 *   SEED_SAMPLE_DATA=false to skip sample products.
 */
import { eq } from "drizzle-orm";
import {
  brands,
  categories,
  coupons,
  createDb,
  deliveryZones,
  mediaFiles,
  productImages,
  productVariants,
  products,
  promotions,
  roles,
  staffUsers,
} from "@ugmall/database";
import { hashPassword } from "@ugmall/auth";
import { ensureInventoryRows, inventory } from "@ugmall/inventory";
import { createStorageFromEnv, processAndStoreImage } from "@ugmall/storage";
import { DEFAULT_ROLES, slugify } from "@ugmall/shared";
import sharp from "sharp";

const { db, client } = createDb();
const storage = createStorageFromEnv();
const isProd = process.env.NODE_ENV === "production";

async function main() {
  // Roles
  for (const [name, r] of Object.entries(DEFAULT_ROLES)) {
    await db
      .insert(roles)
      .values({ name, description: r.description, permissions: r.permissions, isSystem: true })
      .onConflictDoUpdate({ target: roles.name, set: { permissions: r.permissions, description: r.description } });
  }
  const roleId = async (name: string) => (await db.select().from(roles).where(eq(roles.name, name)))[0]!.id;

  // Owner
  const email = (process.env.SEED_ADMIN_EMAIL ?? (isProd ? "" : "admin@shop.local")).toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? (isProd ? "" : "ChangeMe123!");
  if (email && password) {
    const [existing] = await db.select().from(staffUsers).where(eq(staffUsers.email, email));
    if (!existing) {
      await db.insert(staffUsers).values({ email, name: "Shop Owner", passwordHash: await hashPassword(password), roleId: await roleId("owner") });
      console.log(`Created owner ${email}${isProd ? "" : ` / ${password}`}`);
    }
  } else {
    console.log("Skipping owner creation (set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD, or use create-admin)");
  }
  if (!isProd) {
    const [rider] = await db.select().from(staffUsers).where(eq(staffUsers.email, "rider@shop.local"));
    if (!rider) {
      await db.insert(staffUsers).values({ email: "rider@shop.local", name: "Musa (Rider)", phone: "256772000111", passwordHash: await hashPassword("RiderPass123!"), roleId: await roleId("rider") });
      console.log("Created rider rider@shop.local / RiderPass123!");
    }
  }

  // Delivery zones
  const zones: (typeof deliveryZones.$inferInsert)[] = [
    { name: "Kampala Central", district: "Kampala", fee: 5000, etaText: "Same day", methods: ["boda", "internal_rider", "pickup"], sortOrder: 1 },
    { name: "Makindye", district: "Kampala", fee: 6000, etaText: "Same day", methods: ["boda", "internal_rider"], sortOrder: 2 },
    { name: "Ntinda", district: "Kampala", fee: 7000, etaText: "Same day", methods: ["boda", "internal_rider"], sortOrder: 3 },
    { name: "Kira", district: "Wakiso", fee: 8000, etaText: "Same / next day", methods: ["boda", "internal_rider"], sortOrder: 4 },
    { name: "Wakiso", district: "Wakiso", fee: 10000, etaText: "Next day", methods: ["boda", "internal_rider", "third_party"], sortOrder: 5 },
    { name: "Entebbe", district: "Wakiso", fee: 12000, etaText: "Next day", methods: ["boda", "third_party", "courier"], sortOrder: 6 },
    { name: "Upcountry", district: null, fee: null, isCalculated: true, baseFee: 10000, perKgFee: 1500, etaText: "1–3 days by bus parcel/courier", methods: ["bus_parcel", "courier"], sortOrder: 9 },
  ];
  for (const z of zones) await db.insert(deliveryZones).values(z).onConflictDoNothing();

  if (process.env.SEED_SAMPLE_DATA === "false") return;

  // Categories
  const cats = [
    { name: "Men", slug: "men", sortOrder: 1 },
    { name: "Women", slug: "women", sortOrder: 2 },
    { name: "Shoes", slug: "shoes", sortOrder: 3 },
    { name: "Accessories", slug: "accessories", sortOrder: 4 },
  ];
  for (const c of cats) await db.insert(categories).values(c).onConflictDoNothing();
  const catId = async (slug: string) => (await db.select().from(categories).where(eq(categories.slug, slug)))[0]!.id;
  await db.insert(categories).values({ name: "Jeans", slug: "jeans", parentId: await catId("men"), sortOrder: 1 }).onConflictDoNothing();
  await db.insert(categories).values({ name: "Shirts", slug: "shirts", parentId: await catId("men"), sortOrder: 2 }).onConflictDoNothing();
  await db.insert(categories).values({ name: "Dresses", slug: "dresses", parentId: await catId("women"), sortOrder: 1 }).onConflictDoNothing();

  for (const b of ["Levi's", "Kitenge House", "Bata", "Generic"]) await db.insert(brands).values({ name: b, slug: slugify(b) }).onConflictDoNothing();
  const brandId = async (name: string) => (await db.select().from(brands).where(eq(brands.name, name)))[0]!.id;

  const [owner] = await db.select().from(staffUsers).limit(1);
  const samples = [
    {
      name: "Men's Blue Stretch Denim Jeans",
      sku: "BLUE-JEANS-001",
      category: "jeans",
      brand: "Levi's",
      price: 60000,
      salePrice: 58000,
      costPrice: 35000,
      weight: 650,
      colour: "#1d4ed8",
      sizes: ["30", "31", "32", "33", "34", "36", "38", "40", "42", "44", "46", "48"],
      stock: [8, 5, 17, 6, 3, 21, 9, 6, 4, 2, 1, 1],
      description:
        "Comfortable slim-fit stretch denim for everyday wear. 98% cotton, 2% elastane. Machine washable. True to size — if between sizes, pick the larger one.",
      featured: true,
    },
    {
      name: "Men's Black Slim Fit Jeans",
      sku: "BLACK-JEANS-002",
      category: "jeans",
      brand: "Levi's",
      price: 65000,
      costPrice: 38000,
      weight: 650,
      colour: "#111827",
      sizes: ["30", "32", "34", "36", "38", "40"],
      stock: [4, 10, 7, 5, 3, 0],
      description: "Classic black jeans that go with everything.",
      featured: true,
    },
    {
      name: "Kitenge Print Midi Dress",
      sku: "KITENGE-DRESS-01",
      category: "dresses",
      brand: "Kitenge House",
      price: 85000,
      costPrice: 45000,
      weight: 400,
      colour: "#c2410c",
      sizes: ["S", "M", "L", "XL"],
      stock: [3, 6, 4, 2],
      description: "Handmade in Kampala from 100% cotton African print fabric.",
      featured: true,
    },
    {
      name: "Men's Leather Office Shoes",
      sku: "LEATHER-SHOE-01",
      category: "shoes",
      brand: "Bata",
      price: 120000,
      costPrice: 70000,
      weight: 1200,
      colour: "#78350f",
      sizes: ["40", "41", "42", "43", "44", "45"],
      stock: [2, 4, 6, 5, 3, 1],
      description: "Genuine leather lace-up shoes with a cushioned insole.",
      featured: false,
    },
    {
      name: "Cotton Casual Shirt",
      sku: "CASUAL-SHIRT-01",
      category: "shirts",
      brand: "Generic",
      price: 35000,
      costPrice: 18000,
      weight: 250,
      colour: "#0f766e",
      sizes: ["S", "M", "L", "XL", "XXL"],
      stock: [5, 12, 12, 8, 4],
      description: "Breathable cotton shirt for the Kampala heat.",
      featured: false,
    },
  ];

  for (const s of samples) {
    const [exists] = await db.select({ id: products.id }).from(products).where(eq(products.sku, s.sku));
    if (exists) continue;
    const [p] = await db
      .insert(products)
      .values({
        name: s.name,
        slug: slugify(s.name),
        sku: s.sku,
        description: s.description,
        categoryId: await catId(s.category),
        brandId: await brandId(s.brand),
        price: s.price,
        salePrice: s.salePrice ?? null,
        costPrice: s.costPrice,
        weightGrams: s.weight,
        status: "active",
        isFeatured: s.featured,
        optionNames: ["Size"],
        sizes: s.sizes,
        colours: [],
        tags: [s.category],
      })
      .returning();
    for (const [i, size] of s.sizes.entries()) {
      const [v] = await db.insert(productVariants).values({ productId: p!.id, sku: `${s.sku}-${size}`, options: { Size: size }, size, sortOrder: i }).returning();
      await ensureInventoryRows(db, [v!.id]);
      if (s.stock[i]) await inventory.receive(db, v!.id, s.stock[i]!, { note: "Opening stock (seed)", referenceType: "manual", unitCost: s.costPrice, staffId: owner?.id });
    }
    // Placeholder product image generated locally and stored like any upload.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500"><rect width="100%" height="100%" fill="${s.colour}"/><text x="50%" y="48%" font-family="sans-serif" font-size="64" fill="#fff" text-anchor="middle">${s.name.replace(/&/g, "&amp;").replace(/'/g, "&#39;").slice(0, 28)}</text><text x="50%" y="56%" font-family="monospace" font-size="42" fill="#ffffffcc" text-anchor="middle">${s.sku}</text></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const img = await processAndStoreImage(storage, { folderKey: `products/${s.category}/${s.sku}`, baseName: "main", input: png, visibility: "public" });
    const [m] = await db
      .insert(mediaFiles)
      .values({ area: "products", fileName: img.fileName, originalName: "seed.png", mimeType: img.mimeType, fileSize: img.fileSize, width: img.width, height: img.height, checksum: img.checksum, storageProvider: storage.name, storagePath: img.storagePath, publicUrl: img.publicUrl, variants: img.variants })
      .onConflictDoNothing()
      .returning();
    if (m) await db.insert(productImages).values({ productId: p!.id, mediaId: m.id, alt: s.name, sortOrder: 0 });
    console.log(`Seeded ${s.name}`);
  }

  await db.insert(coupons).values({ code: "WELCOME5", description: "UGX 5,000 off your first order", type: "fixed", value: 5000, minOrderAmount: 50000, maxUsesPerCustomer: 1 }).onConflictDoNothing();
  await db
    .insert(promotions)
    .values({ title: "Jeans Week", slug: "jeans-week", description: "10% off all jeans this week", percentOff: 10, categoryIds: [await catId("jeans")], endsAt: new Date(Date.now() + 7 * 86400_000) })
    .onConflictDoNothing();
}

main()
  .then(() => console.log("Seed complete"))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => client.end());
