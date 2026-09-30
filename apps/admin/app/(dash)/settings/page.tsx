"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Badge, Card, PageHeader, StatusBadge, Table, dt, money } from "@/components/ui/kit";

type WhatsAppSettings = {
  hubUrl: string;
  adminNumber: string;
  useTemplates: boolean;
  templateLanguage: string;
  appKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  ready: boolean;
};

const FIELDS: [string, string, "text" | "textarea" | "bool" | "number"][] = [
  ["codMaxOrderTotal", "Cash on Delivery limit (UGX, order total incl. delivery; 0 = no limit)", "number"],
  ["shopName", "Shop name", "text"],
  ["tagline", "Tagline", "text"],
  ["whatsappNumber", "WhatsApp number (2567XXXXXXXX)", "text"],
  ["supportPhone", "Support phone", "text"],
  ["supportEmail", "Support email", "text"],
  ["pickupAddress", "Shop address (invoices & receipts)", "text"],
  ["pickupHours", "Opening hours", "text"],
  ["businessHours", "Business hours", "text"],
  ["announcement", "Announcement bar", "text"],
  ["heroTitle", "Home page headline", "text"],
  ["heroSubtitle", "Home page sub-headline", "text"],
  ["socialFacebook", "Facebook URL", "text"],
  ["socialInstagram", "Instagram URL", "text"],
  ["socialTiktok", "TikTok URL", "text"],
  ["returnPolicy", "Return policy", "textarea"],
];

export default function SettingsPage() {
  const toast = useToast();
  const { data } = useApi<Record<string, string | boolean | number>>("/admin/settings");
  const { data: storage } = useApi<{ driver: string; root?: string; areas: { area: string; files: number; bytes: number }[] }>("/admin/system/storage");
  const { data: queues } = useApi<Record<string, Record<string, number>>>("/admin/system/queues");
  const { data: providers } = useApi<{ id: string; name: string; methods: string[]; offline: boolean; balance: { amount?: number; error?: string } | null }[]>("/admin/payment-providers");
  const { data: notes, reload: reloadNotes } = useApi<{ id: string; template: string; recipient: string; status: string; error: string | null; attempts: number; createdAt: string }[]>("/admin/notifications?limit=50");
  const { data: whatsappSettings, reload: reloadWhatsApp } = useApi<WhatsAppSettings>("/admin/settings/whatsapp");
  const [f, setF] = useState<Record<string, string | boolean | number>>({});
  const [wa, setWa] = useState({ hubUrl: "", adminNumber: "", useTemplates: false, templateLanguage: "en", appKey: "", webhookSecret: "" });
  useEffect(() => {
    if (data) setF(data);
  }, [data]);
  useEffect(() => {
    if (whatsappSettings) setWa((current) => ({ ...current, hubUrl: whatsappSettings.hubUrl, adminNumber: whatsappSettings.adminNumber, useTemplates: whatsappSettings.useTemplates, templateLanguage: whatsappSettings.templateLanguage, appKey: "", webhookSecret: "" }));
  }, [whatsappSettings]);

  const saveWhatsApp = async () => {
    try {
      await api("/admin/settings/whatsapp", { method: "PUT", body: wa });
      await reloadWhatsApp();
      toast("WhatsApp settings saved");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <>
      <PageHeader title="Settings" actions={<Button onClick={async () => { try { await api("/admin/settings", { method: "PUT", body: f }); toast("Settings saved"); } catch (e) { toast((e as Error).message, "error"); } }}>Save settings</Button>} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Shop">
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map(([k, label, type]) => (
              <Field key={k} label={label} className={type === "textarea" ? "sm:col-span-2" : ""}>
                {type === "textarea" ? (
                  <Textarea value={String(f[k] ?? "")} onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))} />
                ) : type === "number" ? (
                  <Input type="number" min={0} step={1000} value={String(f[k] ?? "")} onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value === "" ? 0 : Number(e.target.value) }))} />
                ) : (
                  <Input value={String(f[k] ?? "")} onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))} />
                )}
              </Field>
            ))}
          </div>
        </Card>
        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-2">WhatsApp Support Hub <Badge tone={whatsappSettings?.ready ? "green" : "amber"}>{whatsappSettings?.ready ? "Ready" : "Setup needed"}</Badge></span>} actions={<Button size="sm" onClick={saveWhatsApp}>Save WhatsApp</Button>}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Support Hub URL" className="sm:col-span-2" hint="The URL of your deployed WhatsApp Support Hub.">
                <Input type="url" placeholder="https://whatsapp-support-hub.example.workers.dev" value={wa.hubUrl} onChange={(e) => setWa((s) => ({ ...s, hubUrl: e.target.value }))} />
              </Field>
              <Field label="Application key" hint={whatsappSettings?.appKeyConfigured ? "Configured — leave blank to keep it" : "Create this application key in the Support Hub"}>
                <Input type="password" autoComplete="new-password" value={wa.appKey} onChange={(e) => setWa((s) => ({ ...s, appKey: e.target.value }))} />
              </Field>
              <Field label="Webhook signing secret" hint={whatsappSettings?.webhookSecretConfigured ? "Configured — leave blank to keep it" : "Use the same secret in the Support Hub webhook"}>
                <Input type="password" autoComplete="new-password" value={wa.webhookSecret} onChange={(e) => setWa((s) => ({ ...s, webhookSecret: e.target.value }))} />
              </Field>
              <Field label="Admin WhatsApp number" hint="This active staff number can approve or reject requests in chat.">
                <Input inputMode="tel" placeholder="2567XXXXXXXX" value={wa.adminNumber} onChange={(e) => setWa((s) => ({ ...s, adminNumber: e.target.value.replace(/\D/g, "") }))} />
              </Field>
              <Field label="Template language">
                <Input value={wa.templateLanguage} onChange={(e) => setWa((s) => ({ ...s, templateLanguage: e.target.value }))} />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" className="size-5 accent-brand-700" checked={wa.useTemplates} onChange={(e) => setWa((s) => ({ ...s, useTemplates: e.target.checked }))} />
                Use approved WhatsApp templates for outbound order updates
              </label>
            </div>
            <p className="mt-3 text-xs text-gray-500">Register <code>/api/webhooks/whatsapp-support</code> as this app’s webhook in the Support Hub. Secret values are encrypted and are never shown again.</p>
          </Card>
          <Card title="Payment providers">
            <Table
              rows={providers ?? []}
              columns={[
                { header: "Provider", cell: (p) => p.name },
                { header: "Methods", cell: (p) => p.methods.join(", ") },
                { header: "Wallet balance", cell: (p) => (p.balance?.amount !== undefined ? money(p.balance.amount) : p.balance?.error ? <span className="text-xs text-red-600">{p.balance.error}</span> : "—") },
              ]}
            />
            <p className="mt-2 text-xs text-gray-500">Credentials are configured in the server environment file. PesaPal uses PESAPAL_CONSUMER_KEY, PESAPAL_CONSUMER_SECRET, PESAPAL_IPN_ID and PESAPAL_ENV.</p>
          </Card>
          <Card title="Storage (on this server)">
            <p className="mb-2 text-sm text-gray-600">Driver: <b>{storage?.driver}</b> {storage?.root && <>· root <code>{storage.root}</code></>}</p>
            <Table
              rows={storage?.areas ?? []}
              columns={[
                { header: "Area", cell: (a) => a.area },
                { header: "Files", cell: (a) => a.files },
                { header: "Size", cell: (a) => `${(a.bytes / 1024 / 1024).toFixed(1)} MB` },
              ]}
            />
          </Card>
          <Card title="Background jobs">
            <Table
              rows={Object.entries(queues ?? {})}
              columns={[
                { header: "Queue", cell: ([n]) => n },
                { header: "Waiting", cell: ([, c]) => c.waiting },
                { header: "Delayed", cell: ([, c]) => c.delayed },
                { header: "Failed", cell: ([, c]) => <span className={c.failed ? "text-red-600" : ""}>{c.failed}</span> },
                { header: "Done", cell: ([, c]) => c.completed },
              ]}
            />
          </Card>
          <Card title="WhatsApp notification log">
            <Table
              rows={notes ?? []}
              columns={[
                { header: "When", cell: (n) => dt(n.createdAt) },
                { header: "Message", cell: (n) => n.template },
                { header: "To", cell: (n) => n.recipient },
                { header: "Status", cell: (n) => (<><StatusBadge status={n.status} />{n.error && <div className="max-w-40 truncate text-xs text-red-600" title={n.error}>{n.error}</div>}</>) },
                { header: "", cell: (n) => (n.status === "failed" ? <Button size="sm" variant="ghost" onClick={async () => { await api(`/admin/notifications/${n.id}/retry`, { method: "POST" }); await reloadNotes(); }}>Retry</Button> : null) },
              ]}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
