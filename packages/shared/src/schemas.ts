import { z } from "zod";
import { DELIVERY_METHODS, PAYMENT_METHODS } from "./enums";
import { isValidUgPhone } from "./phone";

export const ugPhone = z.string().trim().refine(isValidUgPhone, "Enter a valid Ugandan phone number, e.g. 0772 123 456");

export const cartLineSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100),
});

export const checkoutSchema = z.object({
  reservationId: z.string().min(8).optional(),
  items: z.array(cartLineSchema).min(1).max(50).optional(),
  customerName: z.string().trim().min(2).max(120),
  phone: ugPhone,
  altPhone: ugPhone.optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  district: z.string().trim().min(2).max(80),
  area: z.string().trim().min(2).max(120),
  address: z.string().trim().min(2).max(300),
  deliveryZoneId: z.string().uuid().optional(),
  deliveryMethod: z.enum(DELIVERY_METHODS),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentPhone: ugPhone.optional().or(z.literal("")),
  couponCode: z.string().trim().max(40).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(3).max(2000),
  name: z.string().trim().min(2).max(80).optional(),
  imageIds: z.array(z.string().uuid()).max(4).optional(),
});
