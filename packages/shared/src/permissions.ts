/**
 * Fine-grained staff permissions. Roles are stored in the database as a list
 * of these strings; `*` grants everything.
 */
export const PERMISSIONS = {
  dashboard: "dashboard.view",
  productsView: "products.view",
  productsManage: "products.manage",
  inventoryView: "inventory.view",
  inventoryAdjust: "inventory.adjust",
  ordersView: "orders.view",
  ordersManage: "orders.manage",
  paymentsView: "payments.view",
  refundsManage: "refunds.manage",
  deliveriesManage: "deliveries.manage",
  riderApp: "rider.app",
  customersView: "customers.view",
  customersManage: "customers.manage",
  reviewsManage: "reviews.manage",
  purchasesManage: "purchases.manage",
  promotionsManage: "promotions.manage",
  reportsView: "reports.view",
  expensesManage: "expenses.manage",
  staffManage: "staff.manage",
  settingsManage: "settings.manage",
  mediaUpload: "media.upload",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS] | "*";
export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

export const DEFAULT_ROLES: Record<string, { description: string; permissions: Permission[] }> = {
  owner: { description: "Full access", permissions: ["*"] },
  manager: {
    description: "Runs the shop day to day",
    permissions: ALL_PERMISSIONS.filter((p) => p !== PERMISSIONS.staffManage && p !== PERMISSIONS.settingsManage),
  },
  sales: {
    description: "Handles orders and customers",
    permissions: [
      PERMISSIONS.dashboard, PERMISSIONS.productsView, PERMISSIONS.inventoryView, PERMISSIONS.ordersView,
      PERMISSIONS.ordersManage, PERMISSIONS.customersView, PERMISSIONS.deliveriesManage, PERMISSIONS.paymentsView,
    ],
  },
  storekeeper: {
    description: "Manages stock and purchases",
    permissions: [
      PERMISSIONS.dashboard, PERMISSIONS.productsView, PERMISSIONS.productsManage, PERMISSIONS.inventoryView,
      PERMISSIONS.inventoryAdjust, PERMISSIONS.purchasesManage, PERMISSIONS.mediaUpload,
    ],
  },
  rider: { description: "Delivery rider", permissions: [PERMISSIONS.riderApp] },
};

export function hasPermission(granted: readonly string[], needed: Permission): boolean {
  return granted.includes("*") || granted.includes(needed);
}
