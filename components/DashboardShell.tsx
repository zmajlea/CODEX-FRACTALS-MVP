"use client";

import { useRouter, usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import AuthSessionSync from "@/components/AuthSessionSync";
import CodexRails from "@/components/CodexRails";
import NoiseOverlay from "@/components/NoiseOverlay";
import SecurityDashboard from "@/components/SecurityDashboard";
import InboxPanel from "@/components/InboxPanel";
import { clearAuthSessionStorage } from "@/lib/auth/oauth";
import { useActiveVault } from "@/lib/context/active-vault";
import { useOverlayStack } from "@/lib/context/overlay-stack";
import { createClient } from "@/utils/supabase/client";
import { ActiveVaultProvider } from "@/lib/context/active-vault";
import { FocusProvider } from "@/lib/context/focus";
import { OverlayStackProvider } from "@/lib/context/overlay-stack";

function DashboardShellInner({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { activeVault, setActiveVault } = useActiveVault();
  const { activeOverlay, openOverlay, closeOverlay } = useOverlayStack();
  const [isSecurityOpen, setIsSecurityOpen] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  const handleSignOut = async () => {
    clearAuthSessionStorage();
    setActiveVault(null);
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const sidebarWidth = "pl-16";

  const vaultIdFromPath = useMemo(() => {
    const match = pathname.match(/\/vault\/([^/]+)/);
    return match?.[1] ?? null;
  }, [pathname]);

  return (
    <div className="min-h-screen bg-vellum relative">
      <AuthSessionSync />
      <NoiseOverlay />
      <CodexRails
        activeRecord={
          activeVault
            ? { id: activeVault.id.slice(0, 8), name: activeVault.name }
            : null
        }
        onSwitchRecord={() => router.push("/switchboard")}
        onOpenSecurity={() => setIsSecurityOpen(true)}
        onOpenInbox={() => openOverlay("inbox")}
        onOpenIngestion={() => {
          if (vaultIdFromPath) router.push(`/vault/${vaultIdFromPath}/ingest`);
          else if (activeVault) router.push(`/vault/${activeVault.id}/ingest`);
        }}
        onOpenProfile={() => router.push("/profile")}
        onOpenRecordSettings={() => {
          if (vaultIdFromPath) router.push(`/vault/${vaultIdFromPath}/settings`);
          else if (activeVault) router.push(`/vault/${activeVault.id}/settings`);
        }}
        onSignOut={handleSignOut}
        inboxUnreadCount={0}
      />

      <SecurityDashboard
        isOpen={isSecurityOpen}
        onClose={() => setIsSecurityOpen(false)}
        recordName={activeVault?.name ?? "Gateway"}
        unlockedVaultCount={0}
        totalVaultCount={0}
      />

      <InboxPanel
        isOpen={activeOverlay === "inbox"}
        onClose={closeOverlay}
      />

      <main className={`pt-16 ${sidebarWidth} relative z-10`}>{children}</main>
    </div>
  );
}

export default function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <ActiveVaultProvider>
      <FocusProvider>
        <OverlayStackProvider>
          <DashboardShellInner>{children}</DashboardShellInner>
        </OverlayStackProvider>
      </FocusProvider>
    </ActiveVaultProvider>
  );
}
