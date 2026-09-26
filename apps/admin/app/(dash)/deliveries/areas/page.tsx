"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, MapPin, Plus, Search } from "lucide-react";
import { PERMISSIONS as P } from "@ugmall/shared";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge, Card, PageHeader, Table, dt, money } from "@/components/ui/kit";

interface Area { id: number; name: string; level: string; path: string; zoneId: string | null; zoneName: string | null; isCustom: boolean; isActive: boolean; children: number }
interface Zone { id: string; name: string; fee: number | null; isCalculated: boolean; baseFee: number | null; perKgFee: number | null; etaText: string | null }
interface Resolved { path: string; zone: Zone | null; zoneFrom: string | null; moreSpecificMayDiffer: boolean; chain: { id: number; name: string; level: string }[] }
interface Typed { place: string; locationPath: string | null; locationId: number | null; orders: number; lastOrder: string }

const LEVEL: Record<string, string> = { region: "Region", district: "District", division: "Division", parish: "Village / Area", village: "Cell" };
const fee = (z: Zone | null) => (!z ? "—" : z.isCalculated ? `from ${money(z.baseFee ?? 0)} + ${money(z.perKgFee ?? 0)}/kg` : money(z.fee));

export default function Areas() {
  const { can } = useSession();
  const toast = useToast();
  const canEdit = can(P.settingsManage);
  const [trail, setTrail] = useState<{ id: number | null; name: string }[]>([{ id: null, name: "Uganda" }]);
  const parent = trail.at(-1)!.id;
  const { data: rows, reload } = useApi<Area[]>(`/admin/locations${parent ? `?parent=${parent}` : ""}`);
  const { data: zones } = useApi<{ items: Zone[] }>("/admin/delivery-zones?limit=200");
  const { data: coverage, reload: reloadCoverage } = useApi<{ id: number; path: string; zoneId: string; level: string }[]>("/admin/delivery-coverage");
  const { data: typed } = useApi<Typed[]>("/admin/locations/typed-places");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: number; name: string; level: string; path: string }[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(() => api<typeof hits>(`/admin/locations/search?q=${encodeURIComponent(q)}`).then(setHits, () => {}), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!selected) return setResolved(null);
    api<Resolved>(`/admin/locations/${selected}/resolve`).then(setResolved, () => setResolved(null));
  }, [selected]);

  const zoneName = (id: string | null) => zones?.items.find((z) => z.id === id)?.name ?? "—";

  async function openArea(id: number) {
    const r = await api<Resolved>(`/admin/locations/${id}/resolve`);
    // navigate the tree to the parent of this area and select it
    const chain = r.chain;
    setTrail([{ id: null, name: "Uganda" }, ...chain.slice(0, -1).map((c) => ({ id: c.id, name: c.name }))]);
    setSelected(id);
    setQ("");
    setHits([]);
  }

  async function setZone(id: number, zoneId: string | null) {
    try {
      await api(`/admin/locations/${id}/zone`, { method: "PUT", body: { zoneId } });
      toast(zoneId ? `Now priced as ${zoneName(zoneId)}` : "Zone removed — inherits from the area above");
      await Promise.all([reload(), reloadCoverage()]);
      setResolved(await api<Resolved>(`/admin/locations/${id}/resolve`));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function addArea() {
    if (!parent || newName.trim().length < 2) return;
    try {
      await api("/admin/locations", { body: { parentId: parent, name: newName.trim() } });
      toast(`Added “${newName.trim()}”`);
      setNewName("");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const byZone = new Map<string, { id: number; path: string }[]>();
  for (const c of coverage ?? []) byZone.set(c.zoneId, [...(byZone.get(c.zoneId) ?? []), c]);

  return (
    <>
      <PageHeader
        title="Delivery areas & fees"
        subtitle="Customers choose Region → District → Division → Village/Area. The fee comes from the nearest area (going up) that has a zone — set a zone on a district for its default, then override divisions or villages."
        actions={<Link href="/deliveries"><Button size="sm" variant="secondary">Zones & deliveries</Button></Link>}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
              <Input className="pl-9" placeholder="Find an area: Ntinda, Kansanga, Kira, Mbarara…" value={q} onChange={(e) => setQ(e.target.value)} />
              {hits.length > 0 && (
                <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
                  {hits.map((h) => (
                    <button key={h.id} className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50" onClick={() => void openArea(h.id)}>
                      <MapPin className="mt-0.5 size-4 text-brand-700" />
                      <span>
                        {h.name} <span className="text-xs text-gray-400">{LEVEL[h.level]}</span>
                        <span className="block text-xs text-gray-500">{h.path}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card
            title={
              <span className="flex flex-wrap items-center gap-1 text-sm font-normal">
                {trail.map((t, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="size-3 text-gray-400" />}
                    <button className={i === trail.length - 1 ? "font-semibold" : "text-brand-700"} onClick={() => { setTrail(trail.slice(0, i + 1)); setSelected(null); }}>
                      {t.name}
                    </button>
                  </span>
                ))}
              </span>
            }
          >
            <Table
              rows={rows ?? []}
              onRowClick={(r) => setSelected(r.id)}
              columns={[
                {
                  header: "Area",
                  cell: (r) => (
                    <span className={r.id === selected ? "font-semibold text-brand-700" : ""}>
                      {r.name} {r.isCustom && <Badge tone="blue">added</Badge>} {!r.isActive && <Badge tone="red">hidden</Badge>}
                    </span>
                  ),
                },
                { header: "Level", cell: (r) => <span className="text-xs text-gray-500">{LEVEL[r.level]}</span> },
                { header: "Zone set here", cell: (r) => (r.zoneName ? <Badge tone="brand">{r.zoneName}</Badge> : <span className="text-xs text-gray-400">inherits</span>) },
                {
                  header: "",
                  cell: (r) =>
                    r.children ? (
                      <button
                        className="flex items-center gap-1 text-xs text-brand-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTrail([...trail, { id: r.id, name: r.name }]);
                          setSelected(null);
                        }}
                      >
                        {r.children} inside <ChevronRight className="size-3" />
                      </button>
                    ) : null,
                },
              ]}
            />
            {canEdit && parent && (
              <div className="mt-3 flex gap-2">
                <Input className="h-10" placeholder={`Add an area missing under ${trail.at(-1)!.name} (e.g. Kitintale)`} value={newName} onChange={(e) => setNewName(e.target.value)} />
                <Button onClick={addArea} disabled={newName.trim().length < 2} className="h-10 shrink-0">
                  <Plus className="size-4" /> Add
                </Button>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Selected area">
            {!resolved ? (
              <p className="text-sm text-gray-500">Click an area to see and change its delivery fee.</p>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="font-medium">{resolved.path}</div>
                <div className="rounded-xl bg-gray-50 p-3">
                  Customer pays: <b>{resolved.zone ? `${resolved.zone.name} — ${fee(resolved.zone)}` : "not delivered"}</b>
                  {resolved.zoneFrom && resolved.zoneFrom !== resolved.path && <div className="text-xs text-gray-500">inherited from {resolved.zoneFrom}</div>}
                  {resolved.moreSpecificMayDiffer && <div className="text-xs text-amber-700">Some areas inside have their own fee.</div>}
                </div>
                {canEdit && selected && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-600">Set a zone on this area (overrides the one above)</label>
                    <Select
                      value={rows?.find((r) => r.id === selected)?.zoneId ?? ""}
                      onChange={(e) => void setZone(selected, e.target.value || null)}
                    >
                      <option value="">— inherit from the area above —</option>
                      {zones?.items.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name} ({fee(z)})
                        </option>
                      ))}
                    </Select>
                    <p className="text-xs text-gray-500">
                      Need a new price? Create a zone on the <Link className="text-brand-700" href="/deliveries">Deliveries</Link> page first.
                    </p>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card title="Coverage by zone">
            <div className="max-h-96 space-y-3 overflow-y-auto text-sm">
              {zones?.items.map((z) => (
                <div key={z.id}>
                  <div className="flex justify-between font-medium">
                    <span>{z.name}</span>
                    <span className="text-gray-500">{fee(z)}</span>
                  </div>
                  <ul className="ml-3 text-xs text-gray-600">
                    {(byZone.get(z.id) ?? []).map((a) => (
                      <li key={a.id}>
                        <button className="text-left hover:text-brand-700" onClick={() => void openArea(a.id)}>
                          {a.path}
                        </button>
                      </li>
                    ))}
                    {!byZone.get(z.id)?.length && <li className="text-amber-700">not assigned to any area</li>}
                  </ul>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Places customers typed">
            <p className="mb-2 text-xs text-gray-500">When a customer’s place isn’t in the list they type it. Add frequent ones as areas so the next customer finds them.</p>
            <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
              {(typed ?? []).map((t) => (
                <li key={t.place} className="flex justify-between gap-2 border-b border-gray-100 py-1">
                  <span>
                    {t.place}
                    <span className="block text-xs text-gray-500">{t.locationPath ?? "no area chosen"}</span>
                  </span>
                  <span className="shrink-0 text-xs text-gray-500">
                    {t.orders}× · {dt(t.lastOrder)}
                    {t.locationId && (
                      <button className="block text-brand-700" onClick={() => void openArea(t.locationId!)}>
                        open area
                      </button>
                    )}
                  </span>
                </li>
              ))}
              {!typed?.length && <li className="text-gray-400">None yet.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
