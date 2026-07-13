"use client";

import { useState } from "react";
import { Field } from "@/components/bcn/atoms/Field";
import { BcnIcon } from "@/components/bcn/BcnIcon";
import { FGrid, Panel } from "@/components/bcn/forms/Panel";
import type { AdvisorsSectionPayload } from "@/lib/bcn/section-payloads";

type Props = {
  value: AdvisorsSectionPayload;
  vaultId?: string;
  clientName?: string;
  onChange: (next: AdvisorsSectionPayload) => void;
  onBlur: () => void;
  disabled?: boolean;
};

const FIELD_KEYS = ["Name", "Firm", "Phone", "Email"] as const;

type InviteState = "idle" | "busy" | "sent" | "error";

export function AdvisorsSectionForm({
  value,
  vaultId,
  clientName,
  onChange,
  onBlur,
  disabled,
}: Props) {
  const [inviteState, setInviteState] = useState<Record<number, InviteState>>({});
  const [inviteError, setInviteError] = useState<Record<number, string>>({});

  async function inviteAdvisor(
    index: number,
    role: string,
    name: string,
    email: string
  ) {
    if (!vaultId) return;

    setInviteState((prev) => ({ ...prev, [index]: "busy" }));
    setInviteError((prev) => ({ ...prev, [index]: "" }));

    const res = await fetch("/api/invites/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultId,
        name,
        email,
        role,
        clientName: clientName ?? "a client",
      }),
    });

    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      setInviteState((prev) => ({ ...prev, [index]: "error" }));
      setInviteError((prev) => ({
        ...prev,
        [index]: body.error ?? "Failed to send invite",
      }));
      return;
    }

    setInviteState((prev) => ({ ...prev, [index]: "sent" }));
  }

  return (
    <Panel title="Trusted Advisors" icon="scale">
      <p className="panel-note">
        Record who advises you, then invite them to the platform so they can be notified if
        your continuity protocol is activated.
      </p>
      {value.advisors.map((block, index) => {
        const advisorName = block.fields.Name?.trim() ?? "";
        const advisorEmail = block.fields.Email?.trim() ?? "";
        const canInvite = Boolean(vaultId && advisorName && advisorEmail && !disabled);
        const state = inviteState[index] ?? "idle";

        return (
          <div className="contact-row" key={block.label}>
            {block.icon ? (
              <span className="ph-ic rb-ic">
                <BcnIcon name={block.icon} />
              </span>
            ) : null}
            <div className="cr-fields">
              <div className="advlabel">{block.label}</div>
              <FGrid>
                {FIELD_KEYS.map((key) => (
                  <Field
                    key={key}
                    label={key}
                    value={block.fields[key] ?? ""}
                    disabled={disabled}
                    onChange={(e) => {
                      const advisors = [...value.advisors];
                      advisors[index] = {
                        ...block,
                        fields: { ...block.fields, [key]: e.target.value },
                      };
                      onChange({ advisors });
                      if (key === "Email" || key === "Name") {
                        setInviteState((prev) => ({ ...prev, [index]: "idle" }));
                      }
                    }}
                    onBlur={onBlur}
                  />
                ))}
              </FGrid>
              {canInvite ? (
                <div className="sealbar" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn sm ghost"
                    disabled={state === "busy" || state === "sent"}
                    onClick={() =>
                      void inviteAdvisor(index, block.label, advisorName, advisorEmail)
                    }
                  >
                    {state === "busy"
                      ? "Sending…"
                      : state === "sent"
                        ? "Platform invite sent"
                        : "Invite to platform"}
                  </button>
                  {state === "error" && inviteError[index] ? (
                    <span className="panel-note">{inviteError[index]}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </Panel>
  );
}
