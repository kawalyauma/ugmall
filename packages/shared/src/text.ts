export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** Safe path segment for storage (SKUs, slugs). */
export function safeSegment(input: string): string {
  const s = input.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 100);
  return s || "item";
}

export function formatOrderNumber(year: number, seq: number): string {
  return `ORD-${year}-${String(seq).padStart(6, "0")}`;
}

/** Human label for a variant's option values: {Size:"34", Colour:"Blue"} -> "Size 34 / Blue". */
export function variantLabel(options: Record<string, string> | null | undefined): string {
  if (!options) return "";
  return Object.entries(options)
    .map(([k, v]) => (k.toLowerCase() === "size" ? `Size ${v}` : v))
    .join(" / ");
}
