"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { LayoutGrid, Loader2, Search, Tag } from "lucide-react";
import { formatUGX } from "@ugmall/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Suggestions {
  products: { name: string; slug: string; price: number; compareAt: number | null; image: string | null; category: string | null }[];
  categories: { name: string; slug: string; parent: string | null }[];
  brands: { name: string; slug: string }[];
  total: number;
}

type Option = { key: string; href: string };

/** Bold the part of `text` that matches what the shopper typed. */
function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (!q || i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <strong className="font-semibold text-gray-900">{text.slice(i, i + q.length)}</strong>
      {text.slice(i + q.length)}
    </>
  );
}

/** Search input with type-ahead suggestions for products, categories and brands. */
export function SearchBox({ defaultValue = "", autoFocus, className, inputClassName }: { defaultValue?: string; autoFocus?: boolean; className?: string; inputClassName?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const listId = useId();
  const [q, setQ] = useState(defaultValue);
  const [data, setData] = useState<Suggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const term = q.trim();

  // Debounced fetch; stale responses are dropped when the query moves on.
  useEffect(() => {
    if (term.length < 2) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api<Suggestions>(`/store/search/suggest?q=${encodeURIComponent(term)}`)
        .then((d) => !cancelled && setData(d))
        .catch(() => !cancelled && setData(null))
        .finally(() => !cancelled && setLoading(false));
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term]);

  useEffect(() => setActive(-1), [data]);
  // Close after navigating anywhere.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const options: Option[] = data
    ? [
        ...data.categories.map((c) => ({ key: `c:${c.slug}`, href: `/c/${c.slug}` })),
        ...data.brands.map((b) => ({ key: `b:${b.slug}`, href: `/search?brand=${encodeURIComponent(b.slug)}` })),
        ...data.products.map((p) => ({ key: `p:${p.slug}`, href: `/p/${p.slug}` })),
        { key: "all", href: `/search?q=${encodeURIComponent(term)}` },
      ]
    : [];
  const idx = (key: string) => options.findIndex((o) => o.key === key);
  const optionId = (key: string) => `${listId}-${idx(key)}`;
  const empty = data && !data.categories.length && !data.brands.length && !data.products.length;
  const show = open && term.length >= 2 && (data !== null || loading);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") return setOpen(false);
    if (!options.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const n = options.length;
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % n : (a - 1 + n) % n));
    } else if (e.key === "Enter" && open && active >= 0) {
      e.preventDefault();
      go(options[active]!.href);
    }
  }

  const row = (key: string) =>
    cn("flex items-center gap-3 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50", idx(key) === active && "bg-brand-50");

  return (
    <div ref={box} className={cn("relative", className)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (term) go(`/search?q=${encodeURIComponent(term)}`);
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoFocus={autoFocus}
          name="q"
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Search products, brands and categories"
          role="combobox"
          aria-expanded={show}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          className={cn(
            "h-10 w-full rounded-full border border-gray-300 bg-gray-50 pl-9 pr-9 text-sm outline-none focus:border-brand-600 focus:bg-white [&::-webkit-search-cancel-button]:hidden",
            inputClassName,
          )}
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-gray-400" />}
      </form>

      {show && (
        <div id={listId} role="listbox" className="absolute inset-x-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white py-2 shadow-xl">
          {!data ? (
            <p className="px-4 py-3 text-sm text-gray-500">Searching…</p>
          ) : empty ? (
            <p className="px-4 py-3 text-sm text-gray-500">No matches for “{term}”. Try a different word.</p>
          ) : (
            <>
              {data.categories.length > 0 && (
                <div>
                  <div className="px-4 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">Categories</div>
                  {data.categories.map((c) => (
                    <Link key={c.slug} id={optionId(`c:${c.slug}`)} role="option" aria-selected={idx(`c:${c.slug}`) === active} href={`/c/${c.slug}`} onClick={() => setOpen(false)} className={row(`c:${c.slug}`)}>
                      <LayoutGrid className="size-4 shrink-0 text-gray-400" />
                      <span className="min-w-0 truncate">
                        <Highlight text={c.name} q={term} />
                        {c.parent && <span className="text-gray-400"> in {c.parent}</span>}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              {data.brands.length > 0 && (
                <div>
                  <div className="px-4 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">Brands</div>
                  {data.brands.map((b) => (
                    <Link key={b.slug} id={optionId(`b:${b.slug}`)} role="option" aria-selected={idx(`b:${b.slug}`) === active} href={`/search?brand=${encodeURIComponent(b.slug)}`} onClick={() => setOpen(false)} className={row(`b:${b.slug}`)}>
                      <Tag className="size-4 shrink-0 text-gray-400" />
                      <span className="min-w-0 truncate">
                        <Highlight text={b.name} q={term} />
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              {data.products.length > 0 && (
                <div>
                  <div className="px-4 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">Products</div>
                  {data.products.map((p) => (
                    <Link key={p.slug} id={optionId(`p:${p.slug}`)} role="option" aria-selected={idx(`p:${p.slug}`) === active} href={`/p/${p.slug}`} onClick={() => setOpen(false)} className={row(`p:${p.slug}`)}>
                      <span className="size-10 shrink-0 overflow-hidden rounded-lg bg-gray-100">{p.image && <img src={p.image} alt="" className="size-full object-cover" loading="lazy" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-1">
                          <Highlight text={p.name} q={term} />
                        </span>
                        <span className="flex items-baseline gap-2 text-xs">
                          <span className="font-bold text-gray-900">{formatUGX(p.price)}</span>
                          {p.compareAt && <span className="text-gray-400 line-through">{formatUGX(p.compareAt)}</span>}
                          {p.category && <span className="truncate text-gray-400">· {p.category}</span>}
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              <Link
                id={optionId("all")}
                role="option"
                aria-selected={idx("all") === active}
                href={`/search?q=${encodeURIComponent(term)}`}
                onClick={() => setOpen(false)}
                className={cn("mt-1 flex items-center gap-2 border-t border-gray-100 px-4 pb-1 pt-3 text-sm font-semibold text-brand-700 hover:bg-gray-50", idx("all") === active && "bg-brand-50")}
              >
                <Search className="size-4" /> See all {data.total > 0 ? `${data.total} ` : ""}results for “{term}”
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
