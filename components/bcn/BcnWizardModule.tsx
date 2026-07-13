"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { BCN_SECTIONS, type BcnSectionPayload } from "@/lib/bcn/sections";
import { SECTION_ICON_BY_ID } from "@/lib/bcn/icons";
import {
  defaultPayloadForSection,
  sectionPayloadHasContent,
} from "@/lib/bcn/section-payloads";
import { fetchBcnSections, saveBcnSection } from "@/lib/bcn/sections-client";
import { BcnContinuityShell } from "@/components/bcn/BcnContinuityShell";
import { BcnThemeStyleInjector } from "@/components/bcn/BcnThemeStyleInjector";
import { TrustedAdvisorInviteModal } from "@/components/bcn/TrustedAdvisorInviteModal";
import type { BcnRailGroup, BcnRailItem } from "@/components/bcn/BcnRail";
import { RecordHub } from "@/components/bcn/RecordHub";
import { SectionView } from "@/components/bcn/SectionView";
import { useSeal } from "@/components/bcn/hooks/useSeal";
import { useBcnThemeOptional } from "@/components/bcn/BcnThemeContext";
import { ClientModuleRailSwitcher } from "@/components/platform/ClientModuleRailSwitcher";
import { useClientGrants } from "@/components/platform/ClientGrantsContext";
import { RecordExportView } from "@/components/bcn/RecordExportView";
import { defaultWordmark } from "@/components/bcn/brand/BcnBrandMarks";
import { CLIENT_LOGIN } from "@/lib/auth/login-flow";

type View = "hub" | "section" | "export";

const PRIVACY_LINE =
  "Encrypted at rest. Only you and the people you authorize can see your information.";

function mergePayload(sectionId: string, raw: BcnSectionPayload): BcnSectionPayload {
  const base = defaultPayloadForSection(sectionId);
  return { ...base, ...raw };
}

export function BcnWizardModule() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const inviteToken = searchParams.get("invite");
  const supabase = createClient();
  const theme = useBcnThemeOptional();
  const { activeGrantId, grants } = useClientGrants();

  const [vaultId, setVaultId] = useState<string | null>(null);
  const [vaultName, setVaultName] = useState("Continuity Record");
  const [who, setWho] = useState<string | null>(null);
  const [view, setView] = useState<View>("hub");
  const [step, setStep] = useState(0);
  const [sections, setSections] = useState<Record<string, BcnSectionPayload>>({});
  const [sectionStatus, setSectionStatus] = useState<
    Record<string, "empty" | "saved" | "sealed">
  >({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sectionSealed, setSectionSealed] = useState(false);
  const [advisorInviteOpen, setAdvisorInviteOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const wordmark = theme.wordmark ?? defaultWordmark(theme.dataBrand);

  const current = BCN_SECTIONS[step]!;

  const loadSections = useCallback(async (id: string) => {
    const rows = await fetchBcnSections(id);
    const next: Record<string, BcnSectionPayload> = {};
    const status: Record<string, "empty" | "saved" | "sealed"> = {};
    for (const row of rows) {
      const payload = mergePayload(row.section_id, row.payload);
      next[row.section_id] = payload;
      if (row.sealed_at) status[row.section_id] = "sealed";
      else if (sectionPayloadHasContent(row.section_id, payload)) {
        status[row.section_id] = "saved";
      } else {
        status[row.section_id] = "empty";
      }
    }
    setSections(next);
    setSectionStatus(status);
  }, []);

  const commitSeal = useCallback(async () => {
    if (!vaultId) return;
    const payload = mergePayload(current.id, sections[current.id] ?? {});
    const sealedAt = new Date().toISOString();

    await saveBcnSection({
      vaultId,
      sectionId: current.id,
      payload,
      sealedAt,
    });

    setSectionStatus((prev) => ({ ...prev, [current.id]: "sealed" }));
    setSectionSealed(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase.from("platform_audit_events").insert({
      actor_id: user?.id ?? null,
      actor_tier: "client",
      action: "ff_section_sealed",
      target_type: "section",
      target_id: current.id,
      payload: { vault_id: vaultId, sealed_at: sealedAt },
    });
  }, [vaultId, sections, current.id, supabase]);

  const {
    state: sealState,
    sealFxPhase,
    handleSeal,
    handleWaxAnimationEnd,
    handleCapAnimationEnd,
  } = useSeal(commitSeal);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.push(CLIENT_LOGIN);
  }, [router, supabase]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        const params = new URLSearchParams({ next: "/client/bcn" });
        if (inviteToken) params.set("invite", inviteToken);
        window.location.href = `${CLIENT_LOGIN}?${params.toString()}`;
        return;
      }

      const display =
        (typeof user.user_metadata?.full_name === "string" &&
          user.user_metadata.full_name.trim()) ||
        user.email?.split("@")[0] ||
        "Client";
      setWho(display);

      if (inviteToken) {
        const { error: acceptErr } = await supabase.rpc("accept_client_invite", {
          p_token: inviteToken,
        });
        if (acceptErr) {
          setError(acceptErr.message);
          setLoading(false);
          return;
        }
      }

      let resolvedVaultId: string | null = null;

      if (inviteToken) {
        const { data: invite } = await supabase
          .from("vault_invites")
          .select("vault_id")
          .eq("invite_token", inviteToken)
          .maybeSingle();
        if (invite?.vault_id) {
          const { data: vault } = await supabase
            .from("vaults")
            .select("id, name")
            .eq("id", invite.vault_id)
            .maybeSingle();
          if (vault) {
            resolvedVaultId = vault.id;
            setVaultName(vault.name);
          }
        }
      } else {
        const grantId =
          activeGrantId ??
          grants.find((g) => g.modules?.slug === "bcn")?.id ??
          grants[0]?.id;

        if (grantId) {
          const { data: grant } = await supabase
            .from("client_module_access")
            .select("vault_id, vaults(id, name)")
            .eq("id", grantId)
            .maybeSingle();

          const vault = grant?.vaults as { id: string; name: string } | null;
          if (grant?.vault_id && vault) {
            resolvedVaultId = vault.id;
            setVaultName(vault.name);
          }
        }
      }

      if (resolvedVaultId) {
        setVaultId(resolvedVaultId);
        try {
          await loadSections(resolvedVaultId);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to load record");
        }
      }

      setLoading(false);
    }
    void init();
  }, [activeGrantId, grants, inviteToken, loadSections, supabase]);

  const saveSection = useCallback(
    async (sectionId: string, unseal = false) => {
      if (!vaultId) return;

      const payload = mergePayload(sectionId, sections[sectionId] ?? {});
      const hasContent = sectionPayloadHasContent(sectionId, payload);

      try {
        await saveBcnSection({
          vaultId,
          sectionId,
          payload,
          unseal,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
        return;
      }

      setSectionStatus((prev) => ({
        ...prev,
        [sectionId]: unseal
          ? hasContent
            ? "saved"
            : "empty"
          : prev[sectionId] === "sealed"
            ? "sealed"
            : hasContent
              ? "saved"
              : "empty",
      }));
    },
    [vaultId, sections]
  );

  const openSection = useCallback((index: number) => {
    if (!BCN_SECTIONS[index]) return;
    setStep(index);
    setView("section");
    setError(null);
  }, []);

  useEffect(() => {
    if (view !== "section") return;
    const id = BCN_SECTIONS[step]?.id;
    if (!id) return;
    setSectionSealed(sectionStatus[id] === "sealed");
  }, [view, step, sectionStatus]);

  const handleSectionEditStart = useCallback(() => {
    const sectionId = current.id;
    if (sectionStatus[sectionId] === "sealed") {
      setSectionStatus((prev) => ({ ...prev, [sectionId]: "saved" }));
      setSectionSealed(false);
      void saveSection(sectionId, true);
    }
  }, [current.id, sectionStatus, saveSection]);

  const railGroups: BcnRailGroup[] = useMemo(
    () => [
      {
        label: "Module",
        items: [
          {
            id: "hub",
            icon: "grid",
            label: "Record home",
            active: view === "hub",
            onClick: () => {
              setView("hub");
              setSectionSealed(false);
            },
          },
          {
            id: "resources",
            icon: "book",
            label: "Resources",
            onClick: () => {},
          },
          {
            id: "inbox",
            icon: "inbox",
            label: "Inbox",
            unreadDot: true,
            onClick: () => {},
          },
        ],
      },
      {
        label: "Sections",
        items: BCN_SECTIONS.map((s, i) => ({
          id: s.id,
          icon: SECTION_ICON_BY_ID[s.id] ?? "doc",
          label: s.short,
          active: view === "section" && step === i,
          sealed: sectionStatus[s.id] === "sealed",
          onClick: () => {
            openSection(i);
          },
        })),
      },
    ],
    [view, step, sectionStatus, openSection]
  );

  const railFootItems: BcnRailItem[] = useMemo(
    () => [
      {
        id: "sharing",
        icon: "share",
        label: "Trusted advisors",
        onClick: () => setAdvisorInviteOpen(true),
      },
      { id: "export", icon: "download", label: "Export", onClick: () => setExportOpen(true) },
      { id: "settings", icon: "gear", label: "Settings", onClick: () => {} },
    ],
    []
  );

  if (loading) return <p className="p-6 text-sm">Loading continuity record…</p>;
  if (!vaultId) {
    return (
      <p className="p-6 text-sm">
        No Business Continuity Navigator grant linked. Ask your operator for an invite.
      </p>
    );
  }

  return (
    <>
      <BcnThemeStyleInjector />
      <BcnContinuityShell
        mode="client"
        dataBrand={theme.dataBrand}
        wordmark={wordmark}
        logoUrl={theme.logoUrl}
        tokenOverrides={theme.tokenOverrides}
        homeHref="#hub"
        recordPill={{
          primary: vaultName,
          secondary: vaultId ? vaultId.slice(0, 8).toUpperCase() : undefined,
        }}
        who={who}
        keyUnlocked
        railGroups={railGroups}
        railFootItems={railFootItems}
        railHead={<ClientModuleRailSwitcher />}
        sectionSealed={sectionSealed}
        sealFxPhase={sealFxPhase}
        onWaxAnimationEnd={handleWaxAnimationEnd}
        onCapAnimationEnd={handleCapAnimationEnd}
        onLogout={() => void handleLogout()}
        showBcnSolutionLine={false}
      >
        {view === "hub" ? (
          <RecordHub
            vaultName={vaultName}
            sectionStatus={sectionStatus}
            onSelect={(id) => {
              const idx = BCN_SECTIONS.findIndex((s) => s.id === id);
              openSection(idx >= 0 ? idx : 0);
            }}
            onNextStep={() => {
              const idx = BCN_SECTIONS.findIndex((s) => sectionStatus[s.id] !== "sealed");
              openSection(idx >= 0 ? idx : 0);
            }}
            onInviteTrusted={() => setAdvisorInviteOpen(true)}
            onExport={() => setExportOpen(true)}
          />
        ) : (
          <SectionView
            section={current}
            vaultName={vaultName}
            vaultId={vaultId}
            signer={who ?? "You"}
            status={sectionStatus[current.id] ?? "empty"}
            payload={mergePayload(current.id, sections[current.id] ?? {})}
            sealing={sealState === "sealing"}
            onHome={() => {
              setView("hub");
              setSectionSealed(false);
            }}
            onPayloadChange={(next) =>
              setSections((prev) => ({ ...prev, [current.id]: next }))
            }
            onSave={() => void saveSection(current.id)}
            onEditStart={handleSectionEditStart}
            onSeal={() => {
              setError(null);
              handleSeal();
            }}
          />
        )}
        {error ? <p className="sec-sub">{error}</p> : null}
        <p className="panel-note px-6 pb-4">{PRIVACY_LINE}</p>
      </BcnContinuityShell>

      <TrustedAdvisorInviteModal
        open={advisorInviteOpen}
        clientName={vaultName}
        vaultId={vaultId}
        onClose={() => setAdvisorInviteOpen(false)}
      />

      {exportOpen && vaultId ? (
        <RecordExportView
          vaultName={vaultName}
          recordId={vaultId.slice(0, 8).toUpperCase()}
          sectionStatus={sectionStatus}
          sections={sections}
          onClose={() => setExportOpen(false)}
          onPrint={() => window.print()}
        />
      ) : null}
    </>
  );
}
