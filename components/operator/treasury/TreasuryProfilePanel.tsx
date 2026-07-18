"use client";

type Contact = {
  name: string;
  role: string;
  scope: string;
  phone?: string | null;
  email?: string | null;
};

type Jurisdiction = {
  loc: string;
  role: string;
};

type Props = {
  clientName: string;
  clientEmail: string;
  grantId: string | null;
  busyAction: string | null;
  onSuspend: () => void;
  onRevoke: () => void;
  /** Optional recorded profile fields — show "—" when unknown (do not invent demo facts). */
  legalEntity?: string | null;
  industry?: string | null;
  fiscalYearEnd?: string | null;
  annualRevenue?: string | null;
  primaryBanks?: string | null;
  contacts?: Contact[];
  jurisdictions?: Jurisdiction[];
};

/**
 * Spec 35-1 — Ana's Profile structure + our Suspend/Revoke (flagged as ours).
 * Verbatim chrome from SUMMIT_SECTIONS su-profile / contactsBlock / jurisdictionsBlock.
 */
export function TreasuryProfilePanel({
  clientName,
  clientEmail,
  grantId,
  busyAction,
  onSuspend,
  onRevoke,
  legalEntity,
  industry,
  fiscalYearEnd,
  annualRevenue,
  primaryBanks,
  contacts,
  jurisdictions,
}: Props) {
  const entity = legalEntity?.trim() || clientName;
  const contactRows: Contact[] =
    contacts && contacts.length > 0
      ? contacts
      : [
          {
            name: clientName,
            role: "Client",
            scope: "Primary contact",
            email: clientEmail,
          },
        ];
  const jurisRows = jurisdictions ?? [];

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="panel-h" style={{ marginBottom: 8 }}>
          <span className="ph-t">Business &amp; Treasury Profile</span>
        </div>
        <p className="text-sm text-codex-muted mb-1">
          Where your cash function stands today — the baseline we improve from.
        </p>
        <p className="treasury-meta-fine mb-4">
          The entity, banking, and treasury process we assess against.
        </p>

        <div className="panel-h">
          <span className="ph-t">Entity &amp; Banking</span>
        </div>
        <div className="fgrid">
          <div className="ffield">
            <span className="fl">Legal entity</span>
            <span className="fv">{entity}</span>
          </div>
          <div className="ffield">
            <span className="fl">Industry</span>
            <span className="fv">{industry?.trim() || "—"}</span>
          </div>
          <div className="ffield">
            <span className="fl">Fiscal year end</span>
            <span className="fv">{fiscalYearEnd?.trim() || "—"}</span>
          </div>
          <div className="ffield">
            <span className="fl">Annual revenue</span>
            <span className="fv">{annualRevenue?.trim() || "—"}</span>
          </div>
          <div className="ffield wide">
            <span className="fl">Primary bank(s)</span>
            <span className="fv">{primaryBanks?.trim() || "—"}</span>
          </div>
        </div>
      </div>

      <div className="ctblock">
        <div className="panel-h" style={{ padding: 0, marginBottom: 10 }}>
          <span className="ph-t">Contacts</span>
          <span className="ph-side">who we reach for what</span>
        </div>
        <div className="ct-head-row">
          <span>Person</span>
          <span>For</span>
          <span>Reach</span>
        </div>
        {contactRows.map((c) => (
          <div key={`${c.name}-${c.email ?? c.phone ?? ""}`} className="ct-row">
            <div className="ct-id">
              <b>{c.name}</b>
              <span>{c.role}</span>
            </div>
            <div className="ct-scope">{c.scope}</div>
            <div className="ct-reach">
              {c.phone ? (
                <a href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`}>{c.phone}</a>
              ) : null}
              {c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : null}
              {!c.phone && !c.email ? <span>—</span> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="juris">
        <div className="panel-h" style={{ padding: 0, marginBottom: 10 }}>
          <span className="ph-t">Jurisdictions</span>
          <span className="ph-side">by operation</span>
        </div>
        <div className="juris-head-row r1">
          <span>Location</span>
          <span>Role</span>
        </div>
        {jurisRows.length === 0 ? (
          <p className="treasury-meta text-sm py-3 px-1">No operations listed yet.</p>
        ) : (
          jurisRows.map((j) => (
            <div key={`${j.loc}-${j.role}`} className="juris-row r1">
              <div className="jr-loc">{j.loc}</div>
              <div className="jr-role">{j.role}</div>
            </div>
          ))
        )}
        <div className="juris-note">Every operation of the business is listable here.</div>
      </div>

      {/* Ours — Ana's Profile has no Suspend/Revoke. Flagged in Spec 35. */}
      <div className="panel p-4">
        <div className="panel-h">
          <span className="ph-t">Access</span>
          <span className="ph-side">operator controls</span>
        </div>
        <p className="text-sm text-codex-muted mb-3">
          Suspend pauses this client&rsquo;s Treasury access. Revoke ends it.
        </p>
        {grantId ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busyAction !== null}
              onClick={onSuspend}
            >
              {busyAction === "suspend" ? "Suspending…" : "Suspend"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busyAction !== null}
              onClick={onRevoke}
            >
              {busyAction === "revoke" ? "Revoking…" : "Revoke"}
            </button>
          </div>
        ) : (
          <p className="treasury-meta-fine">No active grant on this record.</p>
        )}
      </div>
    </div>
  );
}
