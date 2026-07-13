"use client";

import { createContext, useContext, type ReactNode } from "react";

export type ClientGrant = {
  id: string;
  module_id: string;
  distributor_tenant_id: string;
  vault_id: string | null;
  modules: { slug: string; name: string; route_base: string } | null;
  tenants: { name: string } | null;
};

type ClientGrantsValue = {
  grants: ClientGrant[];
  activeGrantId?: string;
};

const ClientGrantsContext = createContext<ClientGrantsValue | null>(null);

export function ClientGrantsProvider({
  grants,
  activeGrantId,
  children,
}: ClientGrantsValue & { children: ReactNode }) {
  return (
    <ClientGrantsContext.Provider value={{ grants, activeGrantId }}>
      {children}
    </ClientGrantsContext.Provider>
  );
}

export function useClientGrants(): ClientGrantsValue {
  const ctx = useContext(ClientGrantsContext);
  if (!ctx) {
    return { grants: [], activeGrantId: undefined };
  }
  return ctx;
}
