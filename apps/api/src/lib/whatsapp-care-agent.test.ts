import { describe, expect, it } from "vitest";
import { parseShoppingBudget, productSearchTerms } from "./whatsapp-care-agent";

describe("WhatsApp shopping language", () => {
  it.each([
    ["black shoes under 80k", 80_000],
    ["I need a charger below UGX 50,000", 50_000],
    ["show me bags, budget of 120000", 120_000],
  ])("extracts a budget from %s", (message, expected) => {
    expect(parseShoppingBudget(message)).toBe(expected);
  });

  it("keeps useful catalogue terms and removes chat filler", () => {
    expect(productSearchTerms("Please show me black shoes under 80k")).toBe("black shoes");
    expect(productSearchTerms("Do you have an iPhone charger in stock?")).toBe("an iphone charger");
  });
});
