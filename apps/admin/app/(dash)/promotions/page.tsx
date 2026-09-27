"use client";

import { COUPON_TYPES } from "@ugmall/shared";
import { Resource } from "@/components/resource";
import { Badge, PageHeader, dt, money } from "@/components/ui/kit";
import { useApi } from "@/lib/hooks";
import { upload } from "@/lib/api";
import { useToast } from "@/components/toast";

export default function PromotionsPage() {
  const toast = useToast();
  const { data: cats } = useApi<{ items: { id: string; name: string }[] }>("/admin/categories?limit=500");
  const { data: prods } = useApi<{ items: { id: string; name: string }[] }>("/admin/products?limit=200&status=active");
  return (
    <>
      <PageHeader
        title="Promotions & coupons"
        subtitle="Promotions discount products automatically; the newest live promotion leads the homepage campaign strip. Coupons are codes customers type at checkout."
      />
      <div className="space-y-4">
        <Resource
          title="Promotions"
          endpoint="/admin/promotions"
          fields={[
            { name: "title", label: "Title", required: true },
            { name: "percentOff", label: "Percent off", type: "number", nullable: true },
            { name: "startsAt", label: "Starts", type: "datetime", nullable: true },
            { name: "endsAt", label: "Ends", type: "datetime", nullable: true },
            { name: "description", label: "Description", type: "textarea", nullable: true },
            { name: "categoryIds", label: "Categories", type: "multiselect", options: (cats?.items ?? []).map((c) => ({ value: c.id, label: c.name })) },
            { name: "productIds", label: "Products", type: "multiselect", options: (prods?.items ?? []).map((c) => ({ value: c.id, label: c.name })) },
            { name: "isActive", label: "Active", type: "checkbox" },
          ]}
          columns={[
            { header: "Title", cell: (r) => r.title as string },
            { header: "Discount", cell: (r) => (r.percentOff ? `${r.percentOff}%` : "—") },
            { header: "Ends", cell: (r) => dt(r.endsAt as string) },
            { header: "Status", cell: (r) => (r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Off</Badge>) },
            {
              header: "Banner",
              cell: (r) => (
                <label className="cursor-pointer text-xs text-brand-700" onClick={(e) => e.stopPropagation()}>
                  {r.bannerId ? "Replace" : "Upload"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      await upload(`/admin/promotions/${r.id}/banner`, f).then(() => toast("Banner uploaded"), (err) => toast(err.message, "error"));
                    }}
                  />
                </label>
              ),
            },
          ]}
        />
        <Resource
          title="Coupons"
          endpoint="/admin/coupons"
          fields={[
            { name: "code", label: "Code", required: true },
            { name: "type", label: "Type", type: "select", options: COUPON_TYPES.map((t) => ({ value: t, label: t.replace("_", " ") })) },
            { name: "value", label: "Value (% or UGX)", type: "number" },
            { name: "maxDiscount", label: "Max discount (UGX)", type: "money", nullable: true },
            { name: "minOrderAmount", label: "Minimum order (UGX)", type: "money" },
            { name: "maxUses", label: "Max uses (total)", type: "number", nullable: true },
            { name: "maxUsesPerCustomer", label: "Uses per customer", type: "number" },
            { name: "startsAt", label: "Starts", type: "datetime", nullable: true },
            { name: "endsAt", label: "Ends", type: "datetime", nullable: true },
            { name: "description", label: "Description", nullable: true },
            { name: "isActive", label: "Active", type: "checkbox" },
          ]}
          columns={[
            { header: "Code", cell: (r) => <code className="font-semibold">{r.code as string}</code> },
            { header: "Type", cell: (r) => (r.type === "percent" ? `${r.value}%` : r.type === "fixed" ? money(r.value as number) : "Free delivery") },
            { header: "Min order", cell: (r) => money(r.minOrderAmount as number) },
            { header: "Used", cell: (r) => `${r.usedCount}${r.maxUses ? ` / ${r.maxUses}` : ""}` },
            { header: "Status", cell: (r) => (r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Off</Badge>) },
          ]}
        />
      </div>
    </>
  );
}
