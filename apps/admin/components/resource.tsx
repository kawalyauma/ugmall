"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { api, qs } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Button } from "./ui/button";
import { Field, Input, Select, Textarea } from "./ui/input";
import { Card, Modal, Table } from "./ui/kit";
import { useToast } from "./toast";

export type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "number" | "money" | "checkbox" | "select" | "textarea" | "date" | "datetime" | "tags" | "multiselect";
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  nullable?: boolean;
};

type Row = Record<string, unknown> & { id: string };

function toForm(row: Row | null, fields: FieldDef[]) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = row?.[f.name];
    if (f.type === "tags") out[f.name] = Array.isArray(v) ? v.join(", ") : "";
    else if (f.type === "checkbox") out[f.name] = row ? Boolean(v) : true;
    else if (f.type === "datetime") out[f.name] = v ? String(v).slice(0, 16) : "";
    else if (f.type === "multiselect") out[f.name] = Array.isArray(v) ? v : [];
    else out[f.name] = v ?? "";
  }
  return out;
}

function fromForm(form: Record<string, unknown>, fields: FieldDef[]) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = form[f.name];
    if (f.type === "number" || f.type === "money") out[f.name] = v === "" || v === null ? (f.nullable ? null : undefined) : Number(v);
    else if (f.type === "tags") out[f.name] = String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (f.type === "checkbox" || f.type === "multiselect") out[f.name] = v;
    else if (f.type === "datetime") out[f.name] = v ? new Date(String(v)).toISOString() : null;
    else out[f.name] = v === "" ? (f.nullable ? null : undefined) : v;
  }
  return out;
}

export function FormFields({ fields, form, set }: { fields: FieldDef[]; form: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => {
        const v = form[f.name];
        const wide = f.type === "textarea" || f.type === "multiselect";
        return (
          <Field key={f.name} label={f.label + (f.required ? " *" : "")} hint={f.hint} className={wide ? "sm:col-span-2" : ""}>
            {f.type === "checkbox" ? (
              <input type="checkbox" className="size-5 accent-brand-700" checked={Boolean(v)} onChange={(e) => set(f.name, e.target.checked)} />
            ) : f.type === "select" ? (
              <Select value={String(v ?? "")} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">—</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : f.type === "multiselect" ? (
              <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-xl border border-gray-200 p-2">
                {f.options?.map((o) => {
                  const arr = (v as string[]) ?? [];
                  const on = arr.includes(o.value);
                  return (
                    <button type="button" key={o.value} onClick={() => set(f.name, on ? arr.filter((x) => x !== o.value) : [...arr, o.value])} className={`rounded-full border px-3 py-1 text-xs ${on ? "border-brand-700 bg-brand-700 text-white" : "border-gray-300"}`}>
                      {o.label}
                    </button>
                  );
                })}
              </div>
            ) : f.type === "textarea" ? (
              <Textarea value={String(v ?? "")} onChange={(e) => set(f.name, e.target.value)} />
            ) : (
              <Input
                type={f.type === "number" || f.type === "money" ? "number" : f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : "text"}
                value={String(v ?? "")}
                onChange={(e) => set(f.name, e.target.value)}
                required={f.required}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}

/** Generic list + create/edit modal for simple admin tables backed by the API's crudRoutes. */
export function Resource({
  title,
  endpoint,
  fields,
  columns,
  searchable = true,
  canDelete = true,
}: {
  title: string;
  endpoint: string;
  fields: FieldDef[];
  columns: { header: string; cell: (r: Row) => React.ReactNode; className?: string }[];
  searchable?: boolean;
  canDelete?: boolean;
}) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const { data, reload } = useApi<{ items: Row[]; total: number }>(`${endpoint}${qs({ q, limit: 500 })}`);
  const [editing, setEditing] = useState<Row | null | "new">(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);

  const open = (row: Row | "new") => {
    setEditing(row);
    setForm(toForm(row === "new" ? null : row, fields));
  };
  async function save() {
    setBusy(true);
    try {
      const body = fromForm(form, fields);
      if (editing === "new") await api(endpoint, { body });
      else if (editing) await api(`${endpoint}/${editing.id}`, { method: "PATCH", body });
      toast("Saved");
      setEditing(null);
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!editing || editing === "new" || !confirm("Delete this record?")) return;
    try {
      await api(`${endpoint}/${editing.id}`, { method: "DELETE" });
      setEditing(null);
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <Card
      title={`${title}${data ? ` (${data.total})` : ""}`}
      actions={
        <>
          {searchable && <Input className="h-9 w-40 text-sm" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />}
          <Button size="sm" onClick={() => open("new")}>
            <Plus className="size-4" /> New
          </Button>
        </>
      }
    >
      <Table rows={data?.items ?? []} columns={columns} onRowClick={open} />
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? `New ${title.replace(/s$/, "").toLowerCase()}` : `Edit`} wide>
        <FormFields fields={fields} form={form} set={(k, v) => setForm((f) => ({ ...f, [k]: v }))} />
        <div className="mt-5 flex justify-between">
          {canDelete && editing !== "new" ? (
            <Button variant="ghost" className="text-red-600" onClick={remove}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={save} loading={busy}>
            Save
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
