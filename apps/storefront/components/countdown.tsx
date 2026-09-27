"use client";

import { useEffect, useState } from "react";

const pad = (n: number) => String(n).padStart(2, "0");

/** Live "ends in" timer; renders nothing on the server so the markup never mismatches. */
export function Countdown({ endsAt, className }: { endsAt: string; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return null;
  const left = Math.max(0, new Date(endsAt).getTime() - now);
  if (!left) return null;
  const s = Math.floor(left / 1000);
  const d = Math.floor(s / 86400);
  const parts = [pad(Math.floor((s % 86400) / 3600)), pad(Math.floor((s % 3600) / 60)), pad(s % 60)];
  return (
    <span className={className}>
      Ends in {d > 0 && <b>{d}d </b>}
      <b className="tabular-nums">{parts.join(":")}</b>
    </span>
  );
}
