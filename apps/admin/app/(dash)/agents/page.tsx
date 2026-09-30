"use client";

import { useMemo, useState } from "react";
import { Bot, Check, ImagePlus, Megaphone, Play, RefreshCw, ShieldCheck, Sparkles, Tag, X } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useToast } from "@/components/toast";
import { Badge, Card, PageHeader, StatusBadge, dt } from "@/components/ui/kit";

type WorkerKey = "catalogue" | "campaigns" | "discounts";
type Run = { id: string; agentKey: WorkerKey; status: string; objective: string | null; summary: string | null; error: string | null; promptVersion: string; inputHash: string; createdAt: string; completedAt: string | null };
type Action = { id: string; runId: string; agentKey: WorkerKey; actionType: string; title: string; explanation: string; risk: "low" | "medium" | "high"; status: string; payload: Record<string, unknown>; beforeSnapshot: unknown; afterSnapshot: unknown; error: string | null; createdAt: string; executedAt: string | null };
type Overview = { items: Run[]; actionCounts: Record<string, number>; workers: WorkerKey[] };

const workers: Record<WorkerKey, { title: string; role: string; icon: typeof Bot; tone: string; examples: string[] }> = {
  catalogue: { title: "Catalogue Manager", role: "Audits product quality, improves content, marks strong products trending and creates safe image formats.", icon: Sparkles, tone: "from-violet-600 to-indigo-700", examples: ["Quality & SEO", "Trending picks", "Image variants"] },
  campaigns: { title: "Campaign Manager", role: "Builds focused, time-boxed storefront campaigns from active products and real stock signals.", icon: Megaphone, tone: "from-rose-500 to-orange-600", examples: ["Campaign strategy", "Product selection", "Timed promotions"] },
  discounts: { title: "Discount Manager", role: "Designs controlled coupon offers with expiry, usage caps and strict discount guardrails.", icon: Tag, tone: "from-emerald-600 to-teal-700", examples: ["Coupon offers", "15% safety cap", "Usage limits"] },
};

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export default function AgentsPage() {
  const toast = useToast();
  const overview = useApi<Overview>("/admin/agents?limit=80");
  const actions = useApi<{ items: Action[] }>("/admin/agents/actions");
  const [objectives, setObjectives] = useState<Record<WorkerKey, string>>({ catalogue: "", campaigns: "", discounts: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"approvals" | "history">("approvals");
  const pending = useMemo(() => (actions.data?.items ?? []).filter((a) => a.status === "awaiting_approval"), [actions.data]);

  const reload = async () => { await Promise.all([overview.reload(), actions.reload()]); };
  const run = async (key: WorkerKey) => {
    setBusy(key);
    try {
      await api(`/admin/agents/${key}/run`, { method: "POST", body: { objective: objectives[key].trim() || null } });
      toast(`${workers[key].title} queued`);
      setObjectives((old) => ({ ...old, [key]: "" }));
      await reload();
    } catch (error) { toast((error as Error).message, "error"); } finally { setBusy(null); }
  };
  const decide = async (action: Action, approve: boolean) => {
    setBusy(action.id);
    try {
      await api(`/admin/agents/actions/${action.id}/${approve ? "approve" : "reject"}`, { method: "POST", body: approve ? undefined : { reason: "Rejected by staff after review" } });
      toast(approve ? "Action approved and executed" : "Action rejected");
      await reload();
    } catch (error) { toast((error as Error).message, "error"); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI Workforce"
        subtitle="Codex-powered business workers. Every recommendation waits for approval and every executed change keeps before/after evidence."
        actions={<button onClick={() => void reload()} className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-gray-50"><RefreshCw className="size-4" /> Refresh</button>}
      />

      <div className="overflow-hidden rounded-2xl bg-slate-950 p-5 text-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3"><div className="rounded-2xl bg-white/10 p-3"><ShieldCheck className="size-7 text-emerald-300" /></div><div><div className="text-lg font-bold">Governed autonomy</div><div className="text-sm text-slate-300">Codex proposes. UG Mall validates. You approve. The audit trail remembers.</div></div></div>
          <div className="flex gap-5 text-center"><div><div className="text-2xl font-black">{pending.length}</div><div className="text-xs text-slate-400">Awaiting approval</div></div><div><div className="text-2xl font-black">{overview.data?.actionCounts.executed ?? 0}</div><div className="text-xs text-slate-400">Executed</div></div><div><div className="text-2xl font-black">3</div><div className="text-xs text-slate-400">Active roles</div></div></div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {(Object.keys(workers) as WorkerKey[]).map((key) => {
          const worker = workers[key]; const Icon = worker.icon;
          const latest = overview.data?.items.find((r) => r.agentKey === key);
          return <Card key={key} className="overflow-hidden p-0">
            <div className={`bg-gradient-to-br ${worker.tone} p-5 text-white`}><div className="flex items-start justify-between"><div className="rounded-xl bg-white/15 p-2.5"><Icon className="size-6" /></div>{latest && <StatusBadge status={latest.status} />}</div><h2 className="mt-4 text-xl font-bold">{worker.title}</h2><p className="mt-1 min-h-10 text-sm text-white/80">{worker.role}</p><div className="mt-4 flex flex-wrap gap-1.5">{worker.examples.map((e) => <span key={e} className="rounded-full bg-white/10 px-2 py-1 text-[11px]">{e}</span>)}</div></div>
            <div className="space-y-3 p-4"><textarea value={objectives[key]} onChange={(e) => setObjectives((old) => ({ ...old, [key]: e.target.value }))} placeholder="Optional focus for this run…" rows={2} className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" /><button disabled={busy !== null || latest?.status === "queued" || latest?.status === "running"} onClick={() => void run(key)} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gray-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"><Play className="size-4" />{latest?.status === "queued" || latest?.status === "running" ? "Worker is running" : "Run worker"}</button>{latest && <div className="text-xs text-gray-500">Last run {dt(latest.createdAt)}{latest.summary && <p className="mt-1 line-clamp-2 text-gray-700">{latest.summary}</p>}{latest.error && <p className="mt-1 text-red-600">{latest.error}</p>}</div>}</div>
          </Card>;
        })}
      </div>

      <div className="flex gap-2 border-b"><button onClick={() => setTab("approvals")} className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab === "approvals" ? "border-brand-600 text-brand-700" : "border-transparent text-gray-500"}`}>Approval inbox ({pending.length})</button><button onClick={() => setTab("history")} className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab === "history" ? "border-brand-600 text-brand-700" : "border-transparent text-gray-500"}`}>Documented history</button></div>

      {tab === "approvals" ? <div className="space-y-3">{pending.length === 0 && <Card className="py-10 text-center text-gray-500"><Check className="mx-auto mb-2 size-8 text-emerald-500" />Nothing is waiting for approval.</Card>}{pending.map((a) => <Card key={a.id}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><Badge tone="brand">{workers[a.agentKey].title}</Badge><Badge tone={a.risk === "high" ? "red" : a.risk === "medium" ? "amber" : "green"}>{a.risk} risk</Badge><span className="text-xs text-gray-400">{dt(a.createdAt)}</span></div><h3 className="mt-2 font-bold">{a.title}</h3><p className="mt-1 max-w-3xl text-sm text-gray-600">{a.explanation}</p></div><div className="flex gap-2"><button disabled={busy !== null} onClick={() => void decide(a, false)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700"><X className="size-4" /> Reject</button><button disabled={busy !== null} onClick={() => void decide(a, true)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"><Check className="size-4" /> Approve & execute</button></div></div>
        <details className="mt-3 rounded-xl bg-gray-50 p-3"><summary className="cursor-pointer text-xs font-semibold text-gray-600">Review exact proposed data</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-gray-700">{pretty(a.payload)}</pre></details>
      </Card>)}</div> : <div className="space-y-3">{(actions.data?.items ?? []).map((a) => <Card key={a.id}><div className="flex flex-wrap items-center gap-2"><StatusBadge status={a.status} /><Badge tone="brand">{workers[a.agentKey].title}</Badge><span className="text-xs text-gray-400">{dt(a.executedAt ?? a.createdAt)}</span></div><div className="mt-2 font-semibold">{a.title}</div><p className="mt-1 text-sm text-gray-600">{a.explanation}</p><details className="mt-3 rounded-xl bg-gray-50 p-3"><summary className="cursor-pointer text-xs font-semibold text-gray-600">Audit evidence</summary><div className="mt-2 grid gap-3 lg:grid-cols-2"><pre className="overflow-auto whitespace-pre-wrap text-xs"><b>Before</b>{"\n"}{pretty(a.beforeSnapshot)}</pre><pre className="overflow-auto whitespace-pre-wrap text-xs"><b>After</b>{"\n"}{pretty(a.afterSnapshot ?? a.error)}</pre></div></details></Card>)}</div>}

      <Card title={<span className="flex items-center gap-2"><ImagePlus className="size-4" /> Image integrity rule</span>}><p className="text-sm text-gray-600">The Catalogue Manager may create square, portrait and detail-crop formats from a real product photo. It cannot manufacture unseen angles, colours, branding or features. Original media remains untouched and each derived file is documented.</p></Card>
    </div>
  );
}
