import { describe, expect, it } from "vitest";
import { buildWhatsAppOrderMessage, canTransition, detectNetwork, formatOrderNumber, formatUGX, normalizeUgPhone, toLocalUgPhone } from "./index";

describe("phone numbers", () => {
  it("normalises Ugandan formats", () => {
    for (const v of ["0772 123 456", "+256772123456", "256772123456", "772123456"]) expect(normalizeUgPhone(v)).toBe("256772123456");
    expect(normalizeUgPhone("0412 123 456")).toBeNull();
    expect(normalizeUgPhone("12345")).toBeNull();
    expect(toLocalUgPhone("+256 701 234 567")).toBe("0701234567");
    expect(detectNetwork("0772123456")).toBe("mtn");
    expect(detectNetwork("0752123456")).toBe("airtel");
  });
});

describe("order lifecycle", () => {
  it("allows the happy paths and blocks nonsense", () => {
    expect(canTransition("awaiting_payment", "paid")).toBe(true);
    expect(canTransition("pending", "confirmed")).toBe(true);
    expect(canTransition("out_for_delivery", "delivered")).toBe(true);
    expect(canTransition("delivered", "pending")).toBe(false);
    expect(canTransition("refunded", "paid")).toBe(false);
    expect(canTransition("awaiting_payment", "delivered")).toBe(false);
  });
});

describe("formatting", () => {
  it("formats money and order numbers", () => {
    expect(formatUGX(118000)).toBe("UGX 118,000");
    expect(formatOrderNumber(2026, 145)).toBe("ORD-2026-000145");
  });
  it("builds the WhatsApp order message", () => {
    const msg = buildWhatsAppOrderMessage([
      { productName: "Men's Blue Stretch Jeans", options: { Size: "34" }, quantity: 2, unitPrice: 58000, sku: "BLUE-JEANS-001" },
    ]);
    expect(msg).toBe(
      "Hello, I would like to order:\n\nMen's Blue Stretch Jeans\nSize: 34\nQuantity: 2\nPrice: UGX 58,000 each\nProduct ID: BLUE-JEANS-001",
    );
  });
});

describe("cash on delivery policy", () => {
  it("allows COD up to and including the limit only", async () => {
    const { codAllowed, DEFAULT_COD_MAX_ORDER_TOTAL } = await import("./enums");
    expect(DEFAULT_COD_MAX_ORDER_TOTAL).toBe(150000);
    expect(codAllowed(150000, 150000)).toBe(true);
    expect(codAllowed(150001, 150000)).toBe(false);
    expect(codAllowed(900000, 0)).toBe(true); // 0 = no limit
  });
});
