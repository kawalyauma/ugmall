/**
 * Ugandan phone number helpers.
 *
 * Canonical storage format is E.164 without the plus: 2567XXXXXXXX.
 * Mobile-money providers (e.g. Ssentezo Wallet) usually want the local
 * format 07XXXXXXXX, so both are provided.
 */
export type MobileNetwork = "mtn" | "airtel" | "unknown";

const MTN_PREFIXES = ["76", "77", "78", "79"];
const AIRTEL_PREFIXES = ["70", "74", "75"];

export function normalizeUgPhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, "");
  let national: string | null = null;
  if (digits.length === 12 && digits.startsWith("256")) national = digits.slice(3);
  else if (digits.length === 10 && digits.startsWith("0")) national = digits.slice(1);
  else if (digits.length === 9) national = digits;
  if (!national || !/^7\d{8}$/.test(national)) return null;
  return `256${national}`;
}

export function isValidUgPhone(input: string): boolean {
  return normalizeUgPhone(input) !== null;
}

/** 2567XXXXXXXX -> 07XXXXXXXX */
export function toLocalUgPhone(input: string): string {
  const n = normalizeUgPhone(input);
  if (!n) throw new Error(`Invalid Ugandan phone number: ${input}`);
  return `0${n.slice(3)}`;
}

export function detectNetwork(input: string): MobileNetwork {
  const n = normalizeUgPhone(input);
  if (!n) return "unknown";
  const prefix = n.slice(3, 5);
  if (MTN_PREFIXES.includes(prefix)) return "mtn";
  if (AIRTEL_PREFIXES.includes(prefix)) return "airtel";
  return "unknown";
}

/** "256772123456" -> "0772 123 456" */
export function prettyUgPhone(input: string): string {
  const n = normalizeUgPhone(input);
  if (!n) return input;
  const local = `0${n.slice(3)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}
