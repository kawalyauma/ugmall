import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  date,
  serial,
} from "drizzle-orm/pg-core";
import {
  COUPON_TYPES,
  DELIVERY_METHODS,
  DELIVERY_STATUSES,
  INVENTORY_MOVEMENT_TYPES,
  ORDER_SOURCES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PRODUCT_STATUSES,
  RETURN_STATUSES,
  REVIEW_STATUSES,
} from "@ugmall/shared";

/* ------------------------------------------------------------------ enums */

export const orderStatusEnum = pgEnum("order_status", ORDER_STATUSES);
export const paymentMethodEnum = pgEnum("payment_method", PAYMENT_METHODS);
export const paymentStatusEnum = pgEnum("payment_status", PAYMENT_STATUSES);
export const deliveryMethodEnum = pgEnum("delivery_method", DELIVERY_METHODS);
export const deliveryStatusEnum = pgEnum("delivery_status", DELIVERY_STATUSES);
export const productStatusEnum = pgEnum("product_status", PRODUCT_STATUSES);
export const movementTypeEnum = pgEnum("inventory_movement_type", INVENTORY_MOVEMENT_TYPES);
export const returnStatusEnum = pgEnum("return_status", RETURN_STATUSES);
export const reviewStatusEnum = pgEnum("review_status", REVIEW_STATUSES);
export const couponTypeEnum = pgEnum("coupon_type", COUPON_TYPES);
export const orderSourceEnum = pgEnum("order_source", ORDER_SOURCES);

export const orderNumberSeq = pgSequence("order_number_seq", { startWith: 1, increment: 1 });

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ------------------------------------------------------------ staff & auth */

export const roles = pgTable("roles", {
  id: id(),
  name: text("name").notNull().unique(),
  description: text("description"),
  permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: createdAt(),
});

export const staffUsers = pgTable("staff_users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  passwordHash: text("password_hash").notNull(),
  roleId: uuid("role_id")
    .notNull()
    .references(() => roles.id),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    staffId: uuid("staff_id").references(() => staffUsers.id),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    details: jsonb("details"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entityType, t.entityId), index("audit_log_created_idx").on(t.createdAt)],
);

/* ------------------------------------------------------------------ media */

/**
 * Metadata for every stored file. The binary lives on the server's storage
 * (local filesystem or MinIO) — never in PostgreSQL.
 */
export const mediaFiles = pgTable(
  "media_files",
  {
    id: id(),
    area: text("area").notNull(), // products | categories | reviews | invoices | ...
    fileName: text("file_name").notNull(),
    originalName: text("original_name"),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    checksum: text("checksum"),
    storageProvider: text("storage_provider").notNull().default("local"),
    storagePath: text("storage_path").notNull().unique(),
    publicUrl: text("public_url"),
    /** Where an imported file was downloaded from (dedupes re-imports). */
    sourceUrl: text("source_url"),
    isPublic: boolean("is_public").notNull().default(true),
    /** Resized renditions: { thumb: {path,url,width}, medium: {...} } */
    variants: jsonb("variants").$type<Record<string, { path: string; url: string | null; width: number; height: number; size: number }>>(),
    uploadedByStaff: uuid("uploaded_by_staff").references(() => staffUsers.id),
    uploadedByCustomer: uuid("uploaded_by_customer"),
    createdAt: createdAt(),
  },
  (t) => [index("media_area_idx").on(t.area), index("media_source_url_idx").on(t.sourceUrl)],
);

/* --------------------------------------------------------------- catalogue */

export const categories = pgTable(
  "categories",
  {
    id: id(),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    /** ID in an external catalogue (e.g. Jumia category 1029598) used to match imports. */
    externalId: text("external_id").unique(),
    description: text("description"),
    imageId: uuid("image_id").references(() => mediaFiles.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("categories_parent_idx").on(t.parentId)],
);

export const brands = pgTable("brands", {
  id: id(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  externalId: text("external_id").unique(),
  logoId: uuid("logo_id").references(() => mediaFiles.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const products = pgTable(
  "products",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    sku: text("sku").notNull().unique(),
    description: text("description"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    /** Selling price in UGX (before any discount). */
    price: integer("price").notNull(),
    costPrice: integer("cost_price").notNull().default(0),
    /** Discounted price; when set and lower than price, it is what customers pay. */
    salePrice: integer("sale_price"),
    saleStartsAt: timestamp("sale_starts_at", { withTimezone: true }),
    saleEndsAt: timestamp("sale_ends_at", { withTimezone: true }),
    weightGrams: integer("weight_grams"),
    status: productStatusEnum("status").notNull().default("draft"),
    isFeatured: boolean("is_featured").notNull().default(false),
    /** Option axes, e.g. ["Size", "Colour"] */
    optionNames: text("option_names").array().notNull().default(sql`'{}'::text[]`),
    sizes: text("sizes").array().notNull().default(sql`'{}'::text[]`),
    colours: text("colours").array().notNull().default(sql`'{}'::text[]`),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** Extra product facts shown as a details table: gender, material, pack contents, ... */
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    ratingAverage: integer("rating_avg_x100").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("products_category_idx").on(t.categoryId),
    index("products_status_idx").on(t.status),
    index("products_search_idx").using(
      "gin",
      sql`to_tsvector('simple', coalesce(${t.name}, '') || ' ' || coalesce(${t.sku}, '') || ' ' || coalesce(${t.description}, ''))`,
    ),
    check("products_price_positive", sql`${t.price} >= 0 AND ${t.costPrice} >= 0`),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull().unique(),
    /** {"Size": "34", "Colour": "Blue"} */
    options: jsonb("options").$type<Record<string, string>>().notNull().default({}),
    size: text("size"),
    colour: text("colour"),
    /** Overrides product price when set. */
    price: integer("price"),
    salePrice: integer("sale_price"),
    costPrice: integer("cost_price"),
    weightGrams: integer("weight_grams"),
    barcode: text("barcode"),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(3),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("variants_product_idx").on(t.productId)],
);

export const productImages = pgTable(
  "product_images",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaFiles.id, { onDelete: "cascade" }),
    alt: text("alt"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("product_images_product_idx").on(t.productId)],
);

/* --------------------------------------------------------------- inventory */

/**
 * Current stock per variant. `reserved` is stock committed to placed-but-not-
 * yet-fulfilled orders. Short-lived checkout holds live in Redis.
 * available = on_hand - reserved - (redis checkout holds)
 */
export const inventoryLevels = pgTable(
  "inventory_levels",
  {
    variantId: uuid("variant_id")
      .primaryKey()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [check("inventory_non_negative", sql`${t.onHand} >= 0 AND ${t.reserved} >= 0 AND ${t.reserved} <= ${t.onHand}`)],
);

/** Append-only audit trail of every stock change. */
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: id(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    type: movementTypeEnum("type").notNull(),
    onHandDelta: integer("on_hand_delta").notNull().default(0),
    reservedDelta: integer("reserved_delta").notNull().default(0),
    onHandAfter: integer("on_hand_after").notNull(),
    reservedAfter: integer("reserved_after").notNull(),
    unitCost: integer("unit_cost"),
    referenceType: text("reference_type"), // order | purchase | return | manual
    referenceId: text("reference_id"),
    note: text("note"),
    staffId: uuid("staff_id").references(() => staffUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("movements_variant_idx").on(t.variantId, t.createdAt),
    index("movements_ref_idx").on(t.referenceType, t.referenceId),
  ],
);

/* --------------------------------------------------------------- customers */

export const customers = pgTable(
  "customers",
  {
    id: id(),
    name: text("name").notNull(),
    phone: text("phone").notNull().unique(), // 2567XXXXXXXX
    altPhone: text("alt_phone"),
    email: text("email"),
    isRegistered: boolean("is_registered").notNull().default(false),
    isBlocked: boolean("is_blocked").notNull().default(false),
    notes: text("notes"),
    lastOrderAt: timestamp("last_order_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("customers_name_idx").on(t.name)],
);

export const customerAddresses = pgTable("customer_addresses", {
  id: id(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  label: text("label"),
  district: text("district").notNull(),
  area: text("area").notNull(),
  address: text("address").notNull(),
  locationId: integer("location_id"),
  nearbyPlace: text("nearby_place"),
  deliveryZoneId: uuid("delivery_zone_id"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: createdAt(),
});

export const wishlistItems = pgTable(
  "wishlist_items",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.productId] })],
);

/* ---------------------------------------------------------------- delivery */

export const deliveryZones = pgTable("delivery_zones", {
  id: id(),
  name: text("name").notNull().unique(),
  district: text("district"),
  /** Flat fee in UGX. Null + isCalculated=true means priced per order (upcountry). */
  fee: integer("fee"),
  isCalculated: boolean("is_calculated").notNull().default(false),
  /** For calculated zones: base + per kg. */
  baseFee: integer("base_fee"),
  perKgFee: integer("per_kg_fee"),
  freeDeliveryThreshold: integer("free_delivery_threshold"),
  etaText: text("eta_text"),
  methods: text("methods").array().notNull().default(sql`'{boda}'::text[]`),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

/**
 * Uganda administrative areas: region > district > division (sub-county /
 * town council) > parish ("area", e.g. Ntinda) > village. Delivery fees come
 * from the nearest area (walking up the tree) that has a delivery zone.
 */
export const LOCATION_LEVELS = ["region", "district", "division", "parish", "village"] as const;
export const locationLevelEnum = pgEnum("location_level", LOCATION_LEVELS);

export const locations = pgTable(
  "locations",
  {
    id: serial("id").primaryKey(),
    parentId: integer("parent_id"),
    level: locationLevelEnum("level").notNull(),
    name: text("name").notNull(),
    /** "Central › Kampala › Nakawa › Ntinda" — denormalised for search results and orders. */
    path: text("path").notNull(),
    deliveryZoneId: uuid("delivery_zone_id").references(() => deliveryZones.id, { onDelete: "set null" }),
    /** Added by staff (not from the official list). */
    isCustom: boolean("is_custom").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    index("locations_parent_idx").on(t.parentId),
    index("locations_zone_idx").on(t.deliveryZoneId),
    index("locations_name_idx").on(sql`lower(${t.name})`),
    uniqueIndex("locations_unique_child").on(t.parentId, t.level, sql`lower(${t.name})`),
  ],
);

/* ---------------------------------------------------------------- promotions */

export const coupons = pgTable("coupons", {
  id: id(),
  code: text("code").notNull().unique(),
  description: text("description"),
  type: couponTypeEnum("type").notNull(),
  value: integer("value").notNull().default(0), // percent (0-100) or UGX
  maxDiscount: integer("max_discount"),
  minOrderAmount: integer("min_order_amount").notNull().default(0),
  maxUses: integer("max_uses"),
  maxUsesPerCustomer: integer("max_uses_per_customer").notNull().default(1),
  usedCount: integer("used_count").notNull().default(0),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

/** Time-boxed offers shown on the storefront ("Offers" page / home banners). */
export const promotions = pgTable("promotions", {
  id: id(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  bannerId: uuid("banner_id").references(() => mediaFiles.id, { onDelete: "set null" }),
  /** percent off applied to the listed products/categories */
  percentOff: smallint("percent_off"),
  productIds: uuid("product_ids").array().notNull().default(sql`'{}'::uuid[]`),
  categoryIds: uuid("category_ids").array().notNull().default(sql`'{}'::uuid[]`),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ orders */

export const orders = pgTable(
  "orders",
  {
    id: id(),
    orderNumber: text("order_number").notNull().unique(),
    /** Unguessable token for guest order tracking links. */
    trackingToken: text("tracking_token").notNull().unique(),
    customerId: uuid("customer_id").references(() => customers.id),
    customerName: text("customer_name").notNull(),
    phone: text("phone").notNull(),
    altPhone: text("alt_phone"),
    email: text("email"),
    district: text("district").notNull(),
    area: text("area").notNull(),
    address: text("address").notNull(),
    /** Chosen area in the location tree and its full path at order time. */
    locationId: integer("location_id"),
    locationPath: text("location_path"),
    /** Place the customer typed when theirs was not in the list ("Opposite Kisaasi Total"). */
    nearbyPlace: text("nearby_place"),
    deliveryZoneId: uuid("delivery_zone_id").references(() => deliveryZones.id),
    deliveryMethod: deliveryMethodEnum("delivery_method").notNull(),
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    paymentStatus: paymentStatusEnum("payment_status").notNull().default("pending"),
    status: orderStatusEnum("status").notNull().default("pending"),
    source: orderSourceEnum("source").notNull().default("web"),
    subtotal: integer("subtotal").notNull(),
    deliveryFee: integer("delivery_fee").notNull().default(0),
    discount: integer("discount").notNull().default(0),
    total: integer("total").notNull(),
    costTotal: integer("cost_total").notNull().default(0),
    amountPaid: integer("amount_paid").notNull().default(0),
    couponCode: text("coupon_code"),
    notes: text("notes"),
    staffNotes: text("staff_notes"),
    /** True once reserved stock was converted to a sale (on_hand decremented). */
    stockCommitted: boolean("stock_committed").notNull().default(false),
    /** True while the order holds reserved stock. */
    stockReserved: boolean("stock_reserved").notNull().default(false),
    riderId: uuid("rider_id").references(() => staffUsers.id),
    createdByStaff: uuid("created_by_staff").references(() => staffUsers.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("orders_status_idx").on(t.status),
    index("orders_created_idx").on(t.createdAt),
    index("orders_customer_idx").on(t.customerId),
    index("orders_phone_idx").on(t.phone),
    index("orders_rider_idx").on(t.riderId),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
    productName: text("product_name").notNull(),
    variantLabel: text("variant_label"),
    sku: text("sku").notNull(),
    imageUrl: text("image_url"),
    unitPrice: integer("unit_price").notNull(),
    unitCost: integer("unit_cost").notNull().default(0),
    quantity: integer("quantity").notNull(),
    lineTotal: integer("line_total").notNull(),
    returnedQuantity: integer("returned_quantity").notNull().default(0),
  },
  (t) => [index("order_items_order_idx").on(t.orderId), index("order_items_variant_idx").on(t.variantId)],
);

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: orderStatusEnum("from_status"),
    toStatus: orderStatusEnum("to_status").notNull(),
    note: text("note"),
    actorType: text("actor_type").notNull(), // system | staff | customer | rider | payment
    actorId: text("actor_id"),
    createdAt: createdAt(),
  },
  (t) => [index("order_history_order_idx").on(t.orderId, t.createdAt)],
);

export const couponRedemptions = pgTable("coupon_redemptions", {
  id: id(),
  couponId: uuid("coupon_id")
    .notNull()
    .references(() => coupons.id),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").references(() => customers.id),
  phone: text("phone").notNull(),
  amount: integer("amount").notNull(),
  createdAt: createdAt(),
});

/* ---------------------------------------------------------------- payments */

export const payments = pgTable(
  "payments",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // ssentezo | cash_on_delivery | pay_on_pickup | ...
    method: paymentMethodEnum("method").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("UGX"),
    status: paymentStatusEnum("status").notNull().default("pending"),
    /** Our unique reference sent to the provider (idempotency key). */
    externalReference: text("external_reference").notNull().unique(),
    providerReference: text("provider_reference"),
    financialTransactionId: text("financial_transaction_id"),
    msisdn: text("msisdn"),
    failureReason: text("failure_reason"),
    refundedAmount: integer("refunded_amount").notNull().default(0),
    collectedBy: uuid("collected_by").references(() => staffUsers.id),
    raw: jsonb("raw"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payments_order_idx").on(t.orderId), index("payments_status_idx").on(t.status)],
);

export const paymentEvents = pgTable(
  "payment_events",
  {
    id: id(),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    kind: text("kind").notNull(), // initiate | callback | status_check | refund
    payload: jsonb("payload"),
    createdAt: createdAt(),
  },
  (t) => [index("payment_events_payment_idx").on(t.paymentId)],
);

export const refunds = pgTable("refunds", {
  id: id(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  paymentId: uuid("payment_id").references(() => payments.id),
  returnId: uuid("return_id"),
  amount: integer("amount").notNull(),
  method: text("method").notNull(), // provider | cash | mobile_money_manual
  reason: text("reason"),
  status: text("status").notNull().default("pending"), // pending | succeeded | failed
  externalReference: text("external_reference").unique(),
  providerReference: text("provider_reference"),
  msisdn: text("msisdn"),
  staffId: uuid("staff_id").references(() => staffUsers.id),
  raw: jsonb("raw"),
  createdAt: createdAt(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/* --------------------------------------------------------------- deliveries */

export const deliveries = pgTable(
  "deliveries",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    riderId: uuid("rider_id").references(() => staffUsers.id),
    method: deliveryMethodEnum("method").notNull(),
    status: deliveryStatusEnum("status").notNull().default("assigned"),
    carrierName: text("carrier_name"), // courier / bus company / 3rd party
    trackingNumber: text("tracking_number"),
    amountToCollect: integer("amount_to_collect").notNull().default(0),
    amountCollected: integer("amount_collected"),
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    cashHandedOver: boolean("cash_handed_over").notNull().default(false),
    cashHandedOverAt: timestamp("cash_handed_over_at", { withTimezone: true }),
    recipientName: text("recipient_name"),
    notes: text("notes"),
    failureReason: text("failure_reason"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("deliveries_rider_idx").on(t.riderId, t.status), index("deliveries_order_idx").on(t.orderId)],
);

/* ------------------------------------------------------------ returns/reviews */

export const returns = pgTable("returns", {
  id: id(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  status: returnStatusEnum("status").notNull().default("requested"),
  reason: text("reason").notNull(),
  items: jsonb("items").$type<{ orderItemId: string; quantity: number; condition: "resellable" | "damaged" }[]>().notNull(),
  imageIds: uuid("image_ids").array().notNull().default(sql`'{}'::uuid[]`),
  refundAmount: integer("refund_amount"),
  staffNotes: text("staff_notes"),
  handledBy: uuid("handled_by").references(() => staffUsers.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    rating: smallint("rating").notNull(),
    title: text("title"),
    body: text("body").notNull(),
    imageIds: uuid("image_ids").array().notNull().default(sql`'{}'::uuid[]`),
    isVerifiedPurchase: boolean("is_verified_purchase").notNull().default(false),
    status: reviewStatusEnum("status").notNull().default("pending"),
    reply: text("reply"),
    createdAt: createdAt(),
  },
  (t) => [index("reviews_product_idx").on(t.productId, t.status), check("rating_range", sql`${t.rating} BETWEEN 1 AND 5`)],
);

/* ------------------------------------------------------ suppliers/purchases */

export const suppliers = pgTable("suppliers", {
  id: id(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const purchases = pgTable("purchases", {
  id: id(),
  reference: text("reference").notNull().unique(),
  supplierId: uuid("supplier_id").references(() => suppliers.id),
  status: text("status").notNull().default("draft"), // draft | ordered | received | cancelled
  totalCost: integer("total_cost").notNull().default(0),
  notes: text("notes"),
  invoiceMediaId: uuid("invoice_media_id").references(() => mediaFiles.id),
  orderedAt: timestamp("ordered_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => staffUsers.id),
  createdAt: createdAt(),
});

export const purchaseItems = pgTable("purchase_items", {
  id: id(),
  purchaseId: uuid("purchase_id")
    .notNull()
    .references(() => purchases.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id")
    .notNull()
    .references(() => productVariants.id),
  quantity: integer("quantity").notNull(),
  unitCost: integer("unit_cost").notNull(),
  receivedQuantity: integer("received_quantity").notNull().default(0),
});

/* ---------------------------------------------------------------- imports */

export const productImports = pgTable("product_imports", {
  id: id(),
  fileName: text("file_name").notNull(),
  storagePath: text("storage_path"),
  format: text("format").notNull(), // jumia | generic
  status: text("status").notNull().default("previewed"), // previewed | completed | failed
  options: jsonb("options"),
  summary: jsonb("summary"),
  staffId: uuid("staff_id").references(() => staffUsers.id),
  createdAt: createdAt(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/* ---------------------------------------------------------------- expenses */

export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    category: text("category").notNull(), // rent, transport, salaries, data, marketing ...
    description: text("description"),
    amount: integer("amount").notNull(),
    spentOn: date("spent_on").notNull(),
    receiptMediaId: uuid("receipt_media_id").references(() => mediaFiles.id),
    staffId: uuid("staff_id").references(() => staffUsers.id),
    createdAt: createdAt(),
  },
  (t) => [index("expenses_spent_idx").on(t.spentOn)],
);

/* ----------------------------------------------------- settings & messaging */

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

export const notificationLog = pgTable(
  "notification_log",
  {
    id: id(),
    channel: text("channel").notNull(), // whatsapp | sms | email
    recipient: text("recipient").notNull(),
    template: text("template").notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    payload: jsonb("payload"),
    status: text("status").notNull().default("queued"), // queued | sent | failed
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("notification_order_idx").on(t.orderId)],
);

export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: id(),
    direction: text("direction").notNull(), // inbound | outbound
    waMessageId: text("wa_message_id").unique(),
    phone: text("phone").notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    body: text("body"),
    payload: jsonb("payload"),
    status: text("status"),
    createdAt: createdAt(),
  },
  (t) => [index("wa_phone_idx").on(t.phone, t.createdAt)],
);

export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type MediaFile = typeof mediaFiles.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type StaffUser = typeof staffUsers.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type DeliveryZone = typeof deliveryZones.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
