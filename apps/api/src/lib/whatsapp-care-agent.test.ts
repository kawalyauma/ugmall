import { describe, expect, it } from "vitest";
import { focusedShoppingTerms, parseShoppingBudget, productSearchTerms, shoppingCategorySlugs } from "./whatsapp-care-agent";

describe("WhatsApp shopping language", () => {
  it.each([
    ["black shoes under 80k", 80_000],
    ["I need a charger below UGX 50,000", 50_000],
    ["show me bags, budget of 120000", 120_000],
    ["Phone ranging in 500k with a good camera", 500_000],
  ])("extracts a budget from %s", (message, expected) => {
    expect(parseShoppingBudget(message)).toBe(expected);
  });

  it("keeps useful catalogue terms and removes chat filler", () => {
    expect(productSearchTerms("Please show me black shoes under 80k")).toBe("black shoes");
    expect(productSearchTerms("Do you have an iPhone charger in stock?")).toBe("an iphone charger");
  });

  it("turns conversational phone requests into category-first searches", () => {
    const text = "Phone ranging in 500k with a good camera";
    expect(shoppingCategorySlugs(text)).toEqual(["smartphones"]);
    expect(focusedShoppingTerms(text)).toBe("");
  });

  it("does not treat support questions as catalogue searches", () => {
    expect(shoppingCategorySlugs("What happens if I click talk to support")).toBeUndefined();
  });
});
