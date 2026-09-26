import { formatUGX } from "./money";

export interface WhatsAppOrderLine {
  productName: string;
  options?: Record<string, string> | null;
  quantity: number;
  unitPrice: number;
  sku: string;
}

/** Builds the "Order on WhatsApp" message shown on product and cart pages. */
export function buildWhatsAppOrderMessage(lines: WhatsAppOrderLine[], extra?: { productUrl?: string }): string {
  const parts = ["Hello, I would like to order:", ""];
  for (const line of lines) {
    parts.push(line.productName);
    for (const [k, v] of Object.entries(line.options ?? {})) parts.push(`${k}: ${v}`);
    parts.push(`Quantity: ${line.quantity}`);
    parts.push(`Price: ${formatUGX(line.unitPrice)} each`);
    parts.push(`Product ID: ${line.sku}`);
    parts.push("");
  }
  if (lines.length > 1) {
    const total = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    parts.push(`Items total: ${formatUGX(total)}`);
  }
  if (extra?.productUrl) parts.push(extra.productUrl);
  return parts.join("\n").trim();
}

export function whatsappLink(phoneE164NoPlus: string, message: string): string {
  return `https://wa.me/${phoneE164NoPlus}?text=${encodeURIComponent(message)}`;
}
