import { formatUGX } from "@ugmall/shared";
import { cn } from "@/lib/utils";

export function Price({ price, compareAt, className, size = "md" }: { price: number; compareAt?: number | null; className?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2", className)}>
      <span className={cn("font-bold text-gray-900", size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-base")}>{formatUGX(price)}</span>
      {compareAt ? <span className="text-sm text-gray-400 line-through">{formatUGX(compareAt)}</span> : null}
    </span>
  );
}
