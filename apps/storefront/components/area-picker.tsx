"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { Field, Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Level = "region" | "district" | "division" | "parish" | "village";
interface Node {
  id: number;
  name: string;
  level: Level;
  hasChildren?: boolean;
}
interface Hit extends Node {
  path: string;
  levelLabel: string;
}
export interface AreaInfo {
  id: number;
  name: string;
  path: string;
  chain: Node[];
  zone: { id: string; name: string; fee: number | null; isCalculated: boolean; etaText: string | null; methods: string[] } | null;
  moreSpecificMayDiffer: boolean;
}

const LEVELS: { level: Level; label: string; placeholder: string }[] = [
  { level: "region", label: "Region", placeholder: "Choose region" },
  { level: "district", label: "District", placeholder: "Choose district" },
  { level: "division", label: "Division / Sub-county", placeholder: "Choose division" },
  { level: "parish", label: "Village / Area", placeholder: "Choose village or area" },
  { level: "village", label: "Cell / Zone (optional)", placeholder: "Choose cell" },
];

const cache = new Map<string, Node[]>();
async function children(parent: number | null): Promise<Node[]> {
  const key = String(parent ?? "root");
  if (!cache.has(key)) cache.set(key, await api<Node[]>(`/store/locations${parent ? `?parent=${parent}` : ""}`));
  return cache.get(key)!;
}

/**
 * Region → District → Division → Village/Area → Cell, plus a search box
 * ("Ntinda", "Kansanga") that fills the dropdowns in one tap.
 */
export function AreaPicker({ value, onChange, error }: { value: number | null; onChange: (info: AreaInfo | null) => void; error?: string }) {
  const [chain, setChain] = useState<(number | null)[]>([null, null, null, null, null]);
  const [options, setOptions] = useState<Node[][]>([[], [], [], [], []]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const loadedFor = useRef<number | null>(null);

  // initial regions
  useEffect(() => {
    children(null).then((regions) => setOptions((o) => [regions, ...o.slice(1)]));
  }, []);

  // restore a saved area (e.g. from last order)
  useEffect(() => {
    if (!value || loadedFor.current === value) return;
    loadedFor.current = value;
    void selectArea(value, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  async function selectArea(id: number, notify = true) {
    const info = await api<AreaInfo>(`/store/locations/${id}`).catch(() => null);
    if (!info) return;
    const ids = LEVELS.map((l) => info.chain.find((c) => c.level === l.level)?.id ?? null);
    const opts: Node[][] = [await children(null)];
    for (let i = 1; i < LEVELS.length; i++) opts.push(ids[i - 1] ? await children(ids[i - 1]!) : []);
    setChain(ids);
    setOptions(opts);
    loadedFor.current = id;
    if (notify) onChange(info);
  }

  async function pick(levelIdx: number, idStr: string) {
    const id = idStr ? Number(idStr) : null;
    const nextChain = chain.map((c, i) => (i < levelIdx ? c : i === levelIdx ? id : null));
    setChain(nextChain);
    const nextOpts = options.map((o, i) => (i <= levelIdx ? o : []));
    if (id && levelIdx + 1 < LEVELS.length) nextOpts[levelIdx + 1] = await children(id);
    setOptions(nextOpts);
    const deepest = [...nextChain].reverse().find((c) => c);
    if (deepest) {
      loadedFor.current = deepest;
      const info = await api<AreaInfo>(`/store/locations/${deepest}`).catch(() => null);
      onChange(info);
    } else onChange(null);
  }

  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    setSearching(true);
    const t = setTimeout(() => {
      api<Hit[]>(`/store/locations/search?q=${encodeURIComponent(q)}`)
        .then(setHits, () => setHits([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <label className="mb-1 block text-sm font-medium text-gray-700">Find your area quickly</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type e.g. Ntinda, Kansanga, Mbarara…" className="pl-9" />
          {q && (
            <button type="button" onClick={() => setQ("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-label="Clear">
              <X className="size-4" />
            </button>
          )}
        </div>
        {(hits.length > 0 || (q.length >= 2 && !searching)) && (
          <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
            {hits.map((h) => (
              <button
                key={h.id}
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
                onClick={() => {
                  setQ("");
                  setHits([]);
                  void selectArea(h.id);
                }}
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-brand-700" />
                <span>
                  <span className="font-medium">{h.name}</span>
                  <span className="block text-xs text-gray-500">{h.path.split(" › ").slice(0, -1).join(" › ")}</span>
                </span>
              </button>
            ))}
            {hits.length === 0 && <p className="px-3 py-2 text-sm text-gray-500">Not found — choose the closest area below and type your place under “Nearby place”.</p>}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {LEVELS.map((l, i) => {
          const opts = options[i] ?? [];
          if (i > 0 && !chain[i - 1]) return null;
          if (i > 0 && opts.length === 0) return null;
          return (
            <Field key={l.level} label={l.label} error={i === 1 && !chain[1] ? error : undefined}>
              <Select value={chain[i] ?? ""} onChange={(e) => void pick(i, e.target.value)} className={cn(!chain[i] && "text-gray-500")}>
                <option value="">{l.placeholder}</option>
                {opts.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
          );
        })}
      </div>
    </div>
  );
}
