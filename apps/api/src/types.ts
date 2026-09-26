import type { Container } from "./container";

export interface StaffPrincipal {
  id: string;
  name: string;
  email: string;
  roleName: string;
  permissions: string[];
}

export interface CustomerPrincipal {
  id: string;
  name: string;
  phone: string;
}

export type AppEnv = {
  Variables: {
    container: Container;
    staff: StaffPrincipal;
    customer: CustomerPrincipal | null;
    sessionToken: string;
    cartId?: string;
  };
};
