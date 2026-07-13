"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BcnIcon } from "@/components/bcn/BcnIcon";
import { useClientGrants } from "@/components/platform/ClientGrantsContext";

const MODULE_DOTS: Record<string, string> = {
  bcn: "#E67E50",
  deadlines: "#2C3E50",
  treasury: "#13385E",
};

function dotForSlug(slug: string | undefined): string {
  if (!slug) return "var(--brand)";
  return MODULE_DOTS[slug] ?? "var(--brand)";
}

export function ClientModuleRailSwitcher() {
  const router = useRouter();
  const { grants, activeGrantId } = useClientGrants();
  const [open, setOpen] = useState(false);

  if (grants.length === 0) return null;

  const active =
    grants.find((g) => g.id === activeGrantId) ?? grants[0] ?? null;
  const activeName = active?.modules?.name ?? "Modules";

  function switchGrant(grantId: string) {
    const grant = grants.find((g) => g.id === grantId);
    if (!grant) return;

    document.cookie = `active_grant_id=${grantId};path=/;max-age=31536000`;
    const base = grant.modules?.route_base ?? "/bcn";
    setOpen(false);
    router.push(`/client${base}`);
    router.refresh();
  }

  if (grants.length === 1) {
    return (
      <div className="rmod">
        <div className="ritem modtrigger on" aria-current="page">
          <BcnIcon name="grid" />
          <span className="ri-t">{activeName}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rmod">
      <div className="ritem modtrigger on">
        <BcnIcon name="grid" />
        <span className="ri-t">Modules</span>
        <button
          type="button"
          className={`mod-chev${open ? " open" : ""}`}
          aria-expanded={open}
          aria-label={open ? "Collapse modules" : "Expand modules"}
          onClick={() => setOpen((v) => !v)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <div className="modswitch" hidden={!open}>
        {grants.map((g) => {
          const isOn = g.id === active?.id;
          const slug = g.modules?.slug;
          return (
            <button
              key={g.id}
              type="button"
              className={`modswitch-item${isOn ? " on" : ""}`}
              onClick={() => switchGrant(g.id)}
            >
              <span
                className="ms-dot"
                style={{ background: dotForSlug(slug) }}
                aria-hidden
              />
              <span className="ri-t">{g.modules?.name ?? "Module"}</span>
              {isOn ? <span className="ms-here" aria-hidden>•</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
