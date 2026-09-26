import { z } from "zod";
import { DELIVERY_METHODS, PAYMENT_METHODS } from "./enums";
import { isValidUgPhone } from "./phone";

export const ugPhone = z.string().trim().refine(isValidUgPhone, "Enter a valid Ugandan phone number, e.g. 0772 123 456");

export const cartLineSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100),
});

export const checkoutBaseSchema = z.object({
    reservationId: z.string().min(8).optional(),
    items: z.array(cartLineSchema).min(1).max(50).optional(),
    customerName: z.string().trim().min(2).max(120),
    phone: ugPhone,
    altPhone: ugPhone.optional().or(z.literal("")),
    email: z.string().email().optional().or(z.literal("")),
    /** Chosen area: region › district › division › village/area (locations table). */
    locationId: z.number().int().positive().optional(),
    /** Typed when the exact place is not in the list, e.g. "Kisaasi, near Total petrol station". */
    nearbyPlace: z.string().trim().max(200).optional().or(z.literal("")),
    /** Filled from the chosen area; only needed when no area is chosen. */
    district: z.string().trim().max(80).optional().or(z.literal("")),
    area: z.string().trim().max(120).optional().or(z.literal("")),
    /** Landmark / directions — the rider's main guide. */
    address: z.string().trim().min(2, "Tell us a landmark near you").max(300),
    /** Legacy / staff override. Customers get the zone from their area. */
    deliveryZoneId: z.string().uuid().optional(),
    deliveryMethod: z.enum(DELIVERY_METHODS),
    paymentMethod: z.enum(PAYMENT_METHODS),
    paymentPhone: ugPhone.optional().or(z.literal("")),
    couponCode: z.string().trim().max(40).optional().or(z.literal("")),
    notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

/** Delivery orders need an area (or, for staff, an explicit zone / typed district + area). */
export const hasDeliveryArea = (v: { deliveryMethod: string; locationId?: number; deliveryZoneId?: string; district?: string; area?: string }) =>
  v.deliveryMethod === "pickup" || !!v.locationId || !!v.deliveryZoneId || !!(v.district && v.area);
export const AREA_RULE = { message: "Choose your district and area", path: ["locationId"] };

export const checkoutSchema = checkoutBaseSchema.refine(hasDeliveryArea, AREA_RULE);
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(3).max(2000),
  name: z.string().trim().min(2).max(80).optional(),
  imageIds: z.array(z.string().uuid()).max(4).optional(),
});
