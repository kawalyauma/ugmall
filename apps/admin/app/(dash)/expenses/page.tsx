"use client";

import { Resource } from "@/components/resource";
import { PageHeader, money } from "@/components/ui/kit";

const CATS = ["Rent", "Salaries", "Transport", "Fuel", "Airtime & data", "Marketing", "Packaging", "Utilities", "Taxes & licences", "Repairs", "Other"];

export default function ExpensesPage() {
  return (
    <>
      <PageHeader title="Expenses" subtitle="Used by the profit report to compute net profit." />
      <Resource
        title="Expenses"
        endpoint="/admin/expenses"
        fields={[
          { name: "spentOn", label: "Date", type: "date", required: true },
          { name: "category", label: "Category", type: "select", options: CATS.map((c) => ({ value: c, label: c })) },
          { name: "amount", label: "Amount (UGX)", type: "money", required: true },
          { name: "description", label: "Description", type: "textarea", nullable: true },
        ]}
        columns={[
          { header: "Date", cell: (r) => String(r.spentOn) },
          { header: "Category", cell: (r) => r.category as string },
          { header: "Description", cell: (r) => (r.description as string) ?? "" },
          { header: "Amount", cell: (r) => money(r.amount as number), className: "text-right" },
        ]}
      />
    </>
  );
}
