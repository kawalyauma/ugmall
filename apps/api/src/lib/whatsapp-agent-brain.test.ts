import { describe, expect, it } from "vitest";
import { hasExplicitPurchaseIntent, redactSensitiveChat } from "./whatsapp-agent-brain";

describe("WhatsApp agent action safety", () => {
  it.each([
    "order for me a Samsung A06 and deliver it to Ntinda",
    "please buy the first one",
    "I want to order this",
    "buy it and send me a payment prompt",
    "send a momo prompt to 0772 123 456",
  ])("recognises an explicit purchase instruction: %s", (message) => {
    expect(hasExplicitPurchaseIntent(message)).toBe(true);
  });

  it.each([
    "how can I buy a phone?",
    "what is the price of Samsung A06?",
    "show me phones in my budget",
    "do you accept mobile money?",
    "I made a payment but it still shows unpaid",
  ])("does not turn advice/support into an order: %s", (message) => {
    expect(hasExplicitPurchaseIntent(message)).toBe(false);
  });

  it("redacts secrets while preserving ordinary payment phone numbers", () => {
    expect(redactSensitiveChat("My PIN is 1234 and pay 0772123456")).toBe("My PIN [REDACTED] and pay 0772123456");
    expect(redactSensitiveChat("card 4242 4242 4242 4242 cvv 123")).toBe("card [CARD REDACTED] cvv [REDACTED]");
  });
});
