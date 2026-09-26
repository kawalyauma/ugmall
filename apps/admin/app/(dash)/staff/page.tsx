"use client";

import { useState } from "react";
import { prettyUgPhone } from "@ugmall/shared";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge, Card, Modal, PageHeader, Table, dt } from "@/components/ui/kit";

interface Staff { id: string; name: string; email: string; phone: string | null; isActive: boolean; roleId: string; roleName: string; lastLoginAt: string | null }
interface Role { id: string; name: string; description: string | null; permissions: string[]; isSystem: boolean; members: number }

export default function StaffPage() {
  const toast = useToast();
  const { data: staff, reload } = useApi<Staff[]>("/admin/staff");
  const { data: roles, reload: reloadRoles } = useApi<{ roles: Role[]; allPermissions: string[] }>("/admin/roles");
  const { data: audit } = useApi<{ id: string; action: string; entityType: string | null; entityId: string | null; staffName: string | null; createdAt: string }[]>("/admin/audit-log?limit=100");
  const [edit, setEdit] = useState<Partial<Staff> & { password?: string } | null>(null);
  const [role, setRole] = useState<Role | null>(null);

  async function saveStaff() {
    if (!edit) return;
    try {
      if (edit.id) await api(`/admin/staff/${edit.id}`, { method: "PATCH", body: { name: edit.name, phone: edit.phone ?? "", roleId: edit.roleId, isActive: edit.isActive, password: edit.password || undefined } });
      else await api("/admin/staff", { body: { name: edit.name, email: edit.email, phone: edit.phone ?? "", roleId: edit.roleId, password: edit.password } });
      toast("Saved");
      setEdit(null);
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <>
      <PageHeader title="Staff & roles" actions={<Button size="sm" onClick={() => setEdit({ isActive: true, roleId: roles?.roles[0]?.id })}>Add staff</Button>} />
      <Table
        rows={staff ?? []}
        onRowClick={(s) => setEdit({ ...s, phone: s.phone ? `0${s.phone.slice(3)}` : "" })}
        columns={[
          { header: "Name", cell: (s) => s.name },
          { header: "Email", cell: (s) => s.email },
          { header: "Phone", cell: (s) => (s.phone ? prettyUgPhone(s.phone) : "—") },
          { header: "Role", cell: (s) => <Badge tone="brand">{s.roleName}</Badge> },
          { header: "Last login", cell: (s) => dt(s.lastLoginAt) },
          { header: "Status", cell: (s) => (s.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Disabled</Badge>) },
        ]}
      />
      <Card title="Roles & permissions" className="mt-6">
        <Table
          rows={roles?.roles ?? []}
          onRowClick={(r) => setRole({ ...r })}
          columns={[
            { header: "Role", cell: (r) => <b>{r.name}</b> },
            { header: "Description", cell: (r) => r.description },
            { header: "Members", cell: (r) => r.members },
            { header: "Permissions", cell: (r) => <span className="text-xs text-gray-500">{r.permissions.includes("*") ? "Everything" : r.permissions.join(", ")}</span> },
          ]}
        />
      </Card>
      <Card title="Recent activity (audit log)" className="mt-6">
        <Table
          rows={audit ?? []}
          columns={[
            { header: "When", cell: (a) => dt(a.createdAt) },
            { header: "Who", cell: (a) => a.staffName ?? "—" },
            { header: "Action", cell: (a) => a.action },
            { header: "Record", cell: (a) => <span className="text-xs text-gray-500">{a.entityType} {a.entityId?.slice(0, 8)}</span> },
          ]}
        />
      </Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit staff" : "Add staff"}>
        {edit && (
          <div className="space-y-3">
            <Field label="Name"><Input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            {!edit.id && <Field label="Email (login)"><Input type="email" value={edit.email ?? ""} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>}
            <Field label="Phone"><Input value={edit.phone ?? ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Role">
              <Select value={edit.roleId ?? ""} onChange={(e) => setEdit({ ...edit, roleId: e.target.value })}>
                {roles?.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </Field>
            <Field label={edit.id ? "New password (leave empty to keep)" : "Password (min 10 characters)"}><Input type="password" value={edit.password ?? ""} onChange={(e) => setEdit({ ...edit, password: e.target.value })} autoComplete="new-password" /></Field>
            {edit.id && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} /> Active</label>
            )}
            <Button className="w-full" onClick={saveStaff}>Save</Button>
          </div>
        )}
      </Modal>
      <Modal open={!!role} onClose={() => setRole(null)} title={`Role: ${role?.name}`} wide>
        {role && (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {roles?.allPermissions.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" disabled={role.permissions.includes("*")} checked={role.permissions.includes("*") || role.permissions.includes(p)} onChange={(e) => setRole({ ...role, permissions: e.target.checked ? [...role.permissions, p] : role.permissions.filter((x) => x !== p) })} />
                  {p}
                </label>
              ))}
            </div>
            <Button
              className="mt-4 w-full"
              disabled={role.permissions.includes("*")}
              onClick={async () => {
                try {
                  await api(`/admin/roles/${role.id}`, { method: "PATCH", body: { permissions: role.permissions } });
                  toast("Role saved");
                  setRole(null);
                  await reloadRoles();
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              }}
            >
              Save permissions
            </Button>
          </>
        )}
      </Modal>
    </>
  );
}
