import { cn } from "@/lib/utils";

/** Small wordmark-style badges for the payment choices (drawn in CSS, no third-party image files). */
export function MtnBadge({ className }: { className?: string }) {
  return <span className={cn("inline-flex h-6 items-center rounded-md bg-yellow-300 px-2 text-[11px] font-black tracking-tight text-black", className)}>MTN MoMo</span>;
}

export function AirtelBadge({ className }: { className?: string }) {
  return <span className={cn("inline-flex h-6 items-center rounded-md bg-red-600 px-2 text-[11px] font-black lowercase tracking-tight text-white", className)}>airtel money</span>;
}

export function VisaBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-md border border-gray-200 bg-white px-2 text-[12px] font-black italic tracking-tight text-[#1a1f71]", className)}>VISA</span>
  );
}

export function MastercardBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-0 rounded-md border border-gray-200 bg-white px-1.5", className)} aria-label="Mastercard">
      <span className="size-3.5 rounded-full bg-[#eb001b]" />
      <span className="-ml-1.5 size-3.5 rounded-full bg-[#f79e1b] mix-blend-multiply" />
    </span>
  );
}

export function PesaPalBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-md bg-[#0b3b8c] px-2 text-[11px] font-bold tracking-tight text-white", className)}>
      pesa<span className="text-[#f7a81b]">pal</span>
    </span>
  );
}

export function CardBrands({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <VisaBadge />
      <MastercardBadge />
    </span>
  );
}
