"use client";

import { useCallback, useEffect, useState } from "react";

type RuleRow = {
  id: string;
  name: string;
  match_merchant: string;
  assign_label: string;
  status: string;
  source: string | null;
};

type RecRow = {
  id: string;
  title: string;
  kind: string;
  category: string;
  status: string;
  source: string | null;
};

type StudyRow = {
  id: string;
  name: string;
  status: string;
  source: string | null;
  derived_snapshot?: {
    validationReport?: { warnings?: string[] };
  } | null;
};

type Props = {
  clientUserId: string;
  onOpenRecommendation?: (recId: string) => void;
};

/** Spec B3 Part D — unified pending proposals from the assistant.
 * Spec B8: metrics excluded — they are active library items, not gated proposals. */
export function AssistantProposals({
  clientUserId,
  onOpenRecommendation,
}: Props) {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [recs, setRecs] = useState<RecRow[]>([]);
  const [studies, setStudies] = useState<StudyRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/assistant-proposals`
    );
    if (!res.ok) return;
    const json = (await res.json()) as {
      rules?: RuleRow[];
      recommendations?: RecRow[];
      studies?: StudyRow[];
    };
    setRules(json.rules ?? []);
    setRecs(json.recommendations ?? []);
    setStudies(json.studies ?? []);
  }, [clientUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  const empty = !rules.length && !recs.length && !studies.length;
  if (empty && !error) return null;

  return (
    <div
      className="panel p-3 space-y-3"
      style={{ border: "1px solid var(--line)" }}
      data-testid="assistant-proposals"
    >
      <p className="sec-title mb-0">Pending from your assistant</p>
      <p className="treasury-meta text-sm">
        Claude proposed these over MCP — validate before they go live.
      </p>
      {error ? <p className="treasury-meta cm-err">{error}</p> : null}

      {rules.map((row) => (
        <ProposalRow
          key={`rule-${row.id}`}
          title={`Rule · ${row.name}`}
          summary={`Payee contains “${row.match_merchant}” → ${row.assign_label}`}
          source="mcp"
          busy={busy === `rule-${row.id}`}
          primaryLabel="Confirm"
          onPrimary={() =>
            void act(`rule-${row.id}`, async () => {
              const res = await fetch(
                `/api/operator/treasury/clients/${clientUserId}/rules/${row.id}/confirm`,
                { method: "POST" }
              );
              if (!res.ok) {
                const j = (await res.json()) as { error?: string };
                throw new Error(j.error ?? "Confirm failed");
              }
            })
          }
          secondaryLabel="Discard"
          onSecondary={() =>
            void act(`rule-${row.id}`, async () => {
              const res = await fetch(
                `/api/operator/treasury/clients/${clientUserId}/rules/${row.id}/discard`,
                { method: "POST" }
              );
              if (!res.ok) {
                const j = (await res.json()) as { error?: string };
                throw new Error(j.error ?? "Discard failed");
              }
            })
          }
        />
      ))}

      {recs.map((row) => (
        <ProposalRow
          key={`rec-${row.id}`}
          title={`${row.kind === "question" ? "Question" : "Recommendation"} · ${row.title}`}
          summary={`Draft · ${row.category}`}
          source="mcp"
          busy={busy === `rec-${row.id}`}
          primaryLabel="Open"
          onPrimary={() => onOpenRecommendation?.(row.id)}
          secondaryLabel="Discard"
          onSecondary={() =>
            void act(`rec-${row.id}`, async () => {
              const res = await fetch(
                `/api/operator/treasury/clients/${clientUserId}/recommendations/${row.id}`,
                {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "discard_draft" }),
                }
              );
              if (!res.ok) {
                const j = (await res.json()) as { error?: string };
                throw new Error(j.error ?? "Discard failed");
              }
            })
          }
        />
      ))}

      {studies.map((row) => {
        const warnings = row.derived_snapshot?.validationReport?.warnings ?? [];
        return (
          <ProposalRow
            key={`study-${row.id}`}
            title={`Results · ${row.name}`}
            summary={
              warnings.length
                ? warnings.slice(0, 2).join("; ")
                : "External model pending confirm"
            }
            source={row.source ?? "mcp"}
            busy={busy === `study-${row.id}`}
            primaryLabel="Confirm"
            onPrimary={() =>
              void act(`study-${row.id}`, async () => {
                const res = await fetch(
                  `/api/operator/treasury/clients/${clientUserId}/studies/${row.id}`,
                  {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "confirmed" }),
                  }
                );
                if (!res.ok) {
                  const j = (await res.json()) as { error?: string };
                  throw new Error(j.error ?? "Confirm failed");
                }
              })
            }
            secondaryLabel="Discard"
            onSecondary={() =>
              void act(`study-${row.id}`, async () => {
                const res = await fetch(
                  `/api/operator/treasury/clients/${clientUserId}/studies/${row.id}`,
                  { method: "DELETE" }
                );
                if (!res.ok) {
                  const j = (await res.json()) as { error?: string };
                  throw new Error(j.error ?? "Discard failed");
                }
              })
            }
          />
        );
      })}
    </div>
  );
}

function ProposalRow(props: {
  title: string;
  summary: string;
  source: string;
  busy: boolean;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel: string;
  onSecondary: () => void;
}) {
  return (
    <div className="border border-[var(--line)] rounded p-3 space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="font-medium mb-0">{props.title}</p>
        <span className="treasury-meta-fine text-xs">{props.source}</span>
      </div>
      <p className="treasury-meta text-sm mb-0">{props.summary}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="chip"
          disabled={props.busy}
          onClick={props.onPrimary}
        >
          {props.primaryLabel}
        </button>
        <button
          type="button"
          className="chip"
          disabled={props.busy}
          onClick={props.onSecondary}
        >
          {props.secondaryLabel}
        </button>
      </div>
    </div>
  );
}
