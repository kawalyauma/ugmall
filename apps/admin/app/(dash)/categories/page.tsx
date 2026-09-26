"use client";

import { Resource } from "@/components/resource";
import { Badge, PageHeader } from "@/components/ui/kit";
import { useApi } from "@/lib/hooks";
import { upload } from "@/lib/api";
import { useToast } from "@/components/toast";

type Cat = { id: string; name: string; slug: string; parentId: string | null };

export default function CategoriesPage() {
  const toast = useToast();
  const { data: cats } = useApi<{ items: Cat[] }>("/admin/categories?limit=500");
  const parents = (cats?.items ?? []).map((c) => ({ value: c.id, label: c.name }));
  return (
    <>
      <PageHeader title="Categories & brands" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Resource
          title="Categories"
          endpoint="/admin/categories"
          fields={[
            { name: "name", label: "Name", required: true },
            { name: "slug", label: "URL slug", hint: "Leave empty to generate" },
            { name: "parentId", label: "Parent category", type: "select", options: parents, nullable: true },
            { name: "sortOrder", label: "Sort order", type: "number" },
            { name: "description", label: "Description", type: "textarea", nullable: true },
            { name: "seoTitle", label: "SEO title", nullable: true },
            { name: "seoDescription", label: "SEO description", nullable: true },
            { name: "isActive", label: "Active", type: "checkbox" },
          ]}
          columns={[
            { header: "Name", cell: (r) => r.name as string },
            { header: "Parent", cell: (r) => (cats?.items ?? []).find((c) => c.id === r.parentId)?.name ?? "—" },
            { header: "Slug", cell: (r) => <code className="text-xs">{r.slug as string}</code> },
            { header: "Status", cell: (r) => (r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Hidden</Badge>) },
            {
              header: "Image",
              cell: (r) => (
                <label className="cursor-pointer text-xs text-brand-700" onClick={(e) => e.stopPropagation()}>
                  {r.imageId ? "Replace" : "Upload"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      await upload(`/admin/categories/${r.id}/image`, f).then(() => toast("Image uploaded"), (err) => toast(err.message, "error"));
                    }}
                  />
                </label>
              ),
            },
          ]}
        />
        <Resource
          title="Brands"
          endpoint="/admin/brands"
          fields={[
            { name: "name", label: "Name", required: true },
            { name: "isActive", label: "Active", type: "checkbox" },
          ]}
          columns={[
            { header: "Name", cell: (r) => r.name as string },
            { header: "Status", cell: (r) => (r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Hidden</Badge>) },
          ]}
        />
      </div>
    </>
  );
}
