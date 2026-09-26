/**
 * All money in the platform is stored as integer Uganda Shillings (UGX has no
 * minor unit in practice). Never use floats for money.
 */
export const CURRENCY = "UGX" as const;

export function formatUGX(amount: number | bigint | null | undefined): string {
  const n = typeof amount === "bigint" ? Number(amount) : (amount ?? 0);
  return `UGX ${Math.round(n).toLocaleString("en-US")}`;
}

/** Apply a percentage discount and round to the nearest shilling. */
export function percentOf(amount: number, percent: number): number {
  return Math.round((amount * percent) / 100);
}

/** Round up to the nearest `step` (e.g. 500 or 1,000 shillings) for tidy prices. */
export function roundUpTo(amount: number, step: number): number {
  if (step <= 0) return amount;
  return Math.ceil(amount / step) * step;
}

export function assertMoney(value: number, label = "amount"): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative whole number of UGX`);
  }
  return value;
}
