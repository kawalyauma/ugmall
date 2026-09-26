import { inArray } from "drizzle-orm";
import { settings, type Database } from "@ugmall/database";

export interface ShopSettings {
  shopName: string;
  tagline: string;
  whatsappNumber: string; // 2567XXXXXXXX
  supportPhone: string;
  supportEmail: string;
  pickupAddress: string;
  pickupHours: string;
  businessHours: string;
  heroTitle: string;
  heroSubtitle: string;
  announcement: string;
  socialFacebook: string;
  socialInstagram: string;
  socialTiktok: string;
  returnPolicy: string;
  lowStockEmailAlerts: boolean;
}

export const DEFAULT_SETTINGS: ShopSettings = {
  shopName: process.env.SHOP_NAME ?? "UG Mall",
  tagline: "Quality fashion delivered across Uganda",
  whatsappNumber: "256700000000",
  supportPhone: "0700 000 000",
  supportEmail: "hello@shop.example.ug",
  pickupAddress: "Plot 1, Kampala Road, Kampala",
  pickupHours: "Mon–Sat 9:00am – 7:00pm",
  businessHours: "Mon–Sat 8:00am – 8:00pm",
  heroTitle: "Shop smart. Pay with Mobile Money.",
  heroSubtitle: "Fast boda delivery in Kampala and upcountry by bus parcel.",
  announcement: "Free delivery in Kampala on orders over UGX 200,000",
  socialFacebook: "",
  socialInstagram: "",
  socialTiktok: "",
  returnPolicy: "Returns accepted within 7 days for unworn items with tags.",
  lowStockEmailAlerts: false,
};

const PUBLIC_KEYS: (keyof ShopSettings)[] = [
  "shopName", "tagline", "whatsappNumber", "supportPhone", "supportEmail", "pickupAddress", "pickupHours",
  "businessHours", "heroTitle", "heroSubtitle", "announcement", "socialFacebook", "socialInstagram", "socialTiktok", "returnPolicy",
];

export async function getSettings(db: Database): Promise<ShopSettings> {
  const rows = await db.select().from(settings).where(inArray(settings.key, Object.keys(DEFAULT_SETTINGS)));
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) out[r.key] = r.value;
  return out as unknown as ShopSettings;
}

export async function getPublicSettings(db: Database) {
  const s = await getSettings(db);
  return Object.fromEntries(PUBLIC_KEYS.map((k) => [k, s[k]])) as Partial<ShopSettings>;
}

export async function saveSettings(db: Database, patch: Partial<ShopSettings>) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    await db.insert(settings).values({ key, value: value as unknown as object }).onConflictDoUpdate({ target: settings.key, set: { value: value as unknown as object, updatedAt: new Date() } });
  }
}
