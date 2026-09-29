export interface ImageDTO {
  id: string;
  url: string | null;
  medium: string | null;
  thumb: string | null;
  alt: string | null;
  variantId: string | null;
  width: number | null;
  height: number | null;
}

export interface ProductCard {
  id: string;
  name: string;
  slug: string;
  sku: string;
  price: number;
  compareAt: number | null;
  discountPercent: number;
  image: ImageDTO | null;
  hoverImage: ImageDTO | null;
  category: { name: string; slug: string } | null;
  brand: string | null;
  sizes: string[];
  colours: string[];
  rating: { average: number; count: number } | null;
  inStock: boolean;
}

export interface RecommendedProduct extends ProductCard {
  /** Why the For You engine picked it. */
  reason: "for_you" | "similar" | "trending" | "new" | "deal" | "explore" | "popular";
}

export interface Variant {
  id: string;
  sku: string;
  options: Record<string, string>;
  price: number;
  compareAt: number | null;
  available: number;
  lowStock: boolean;
}

export interface ProductDetail extends Omit<ProductCard, "image" | "hoverImage" | "category" | "inStock"> {
  description: string | null;
  optionNames: string[];
  tags: string[];
  attributes: Record<string, string>;
  category: { id: string; name: string; slug: string } | null;
  seo: { title: string; description: string | null };
  images: ImageDTO[];
  variants: Variant[];
  related: ProductCard[];
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  description: string | null;
  image: string | null;
}

export interface ShopSettings {
  shopName: string;
  tagline: string;
  whatsappNumber: string;
  supportPhone: string;
  supportEmail: string;
  pickupAddress: string;
  pickupHours: string;
  codMaxOrderTotal: number;
  businessHours: string;
  heroTitle: string;
  heroSubtitle: string;
  announcement: string;
  returnPolicy: string;
  socialFacebook: string;
  socialInstagram: string;
  socialTiktok: string;
  paymentMethods: string[];
  /** Online methods, who processes them and whether that provider is currently healthy. */
  paymentOptions?: PaymentOption[];
}

export interface PaymentOption {
  method: "mtn_momo" | "airtel_money" | "card";
  provider: string;
  providerName: string;
  health: "ok" | "degraded";
  fallbackMethod: "card" | null;
}

export interface CartLine {
  variantId: string;
  productId: string;
  productName: string;
  productSlug: string;
  sku: string;
  options: Record<string, string>;
  variantLabel: string;
  quantity: number;
  unitPrice: number;
  compareAt: number | null;
  lineTotal: number;
  imageUrl: string | null;
  available: number;
}

export interface Cart {
  items: CartLine[];
  count: number;
  subtotal: number;
  hasStockIssues: boolean;
  notice?: string;
}

export interface Zone {
  id: string;
  name: string;
  district: string | null;
  fee: number | null;
  isCalculated: boolean;
  baseFee: number | null;
  freeDeliveryThreshold: number | null;
  etaText: string | null;
  methods: string[];
}
