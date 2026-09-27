"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DealSlide {
  id: string;
  title: string;
  slug: string;
  subtitle: string | null;
  image: string | null;
  mobileImage: string | null;
}

const INTERVAL = 5000;

/** Auto-advancing slider of staff-uploaded deal graphics; each slide opens that deal's products. */
export function DealsCarousel({ slides }: { slides: DealSlide[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState(0);
  const n = slides.length;

  const go = useCallback((i: number) => setIndex(((i % n) + n) % n), [n]);

  useEffect(() => {
    if (n < 2 || paused) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") setIndex((i) => (i + 1) % n);
    }, INTERVAL);
    return () => clearInterval(t);
  }, [n, paused, index]);

  if (!n) return null;

  return (
    <section
      className="group relative overflow-hidden rounded-2xl bg-gray-200 shadow-sm"
      aria-roledescription="carousel"
      aria-label="Deals"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={(e) => {
        touch.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
        setPaused(true);
      }}
      onTouchMove={(e) => {
        if (!touch.current) return;
        const dx = e.touches[0]!.clientX - touch.current.x;
        if (Math.abs(dx) > Math.abs(e.touches[0]!.clientY - touch.current.y)) setDrag(dx);
      }}
      onTouchEnd={() => {
        if (Math.abs(drag) > 50) go(index + (drag < 0 ? 1 : -1));
        touch.current = null;
        setDrag(0);
        setPaused(false);
      }}
    >
      <div
        className={cn("flex", drag === 0 && "transition-transform duration-500 ease-out")}
        style={{ transform: `translateX(calc(${-index * 100}% + ${drag}px))` }}
      >
        {slides.map((s, i) => (
          <Link
            key={s.id}
            href={`/deals/${s.slug}`}
            className="relative block aspect-[2/1] w-full shrink-0 md:aspect-[3/1]"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${n}: ${s.title}`}
            aria-hidden={i !== index}
            tabIndex={i === index ? 0 : -1}
            draggable={false}
          >
            <picture>
              {s.mobileImage && <source media="(max-width: 767px)" srcSet={s.mobileImage} />}
              <img
                src={s.image ?? s.mobileImage ?? ""}
                alt={s.title}
                className="size-full object-cover"
                loading={i === 0 ? "eager" : "lazy"}
                fetchPriority={i === 0 ? "high" : undefined}
                draggable={false}
              />
            </picture>
          </Link>
        ))}
      </div>

      {n > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(index - 1)}
            className="absolute left-3 top-1/2 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-gray-800 shadow opacity-0 transition hover:bg-white group-hover:opacity-100 md:grid"
            aria-label="Previous deal"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            className="absolute right-3 top-1/2 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-gray-800 shadow opacity-0 transition hover:bg-white group-hover:opacity-100 md:grid"
            aria-label="Next deal"
          >
            <ChevronRight className="size-5" />
          </button>
          <div className="absolute inset-x-0 bottom-2.5 flex justify-center gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => go(i)}
                aria-label={`Show deal ${i + 1}`}
                aria-current={i === index}
                className={cn("h-1.5 rounded-full bg-white/60 shadow transition-all", i === index ? "w-6 bg-white" : "w-1.5 hover:bg-white/90")}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
