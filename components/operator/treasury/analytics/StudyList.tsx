"use client";

import { useMemo } from "react";
import { CashModelRunwayChip } from "@/components/operator/treasury/cash-model/CashModelRunwayChip";
import {
  isKnownStudyType,
  STUDY_REGISTRY,
  studyTypeLabel,
} from "@/components/operator/treasury/analytics/study-registry";
import type { CashModelRunwayStatus } from "@/lib/treasury/cash-model-types";
import type { TreasuryStudyRow } from "@/lib/treasury/studies";

type Props = {
  studies: TreasuryStudyRow[];
  activeId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  /** Resolve account_id → display name (not raw scope id). */
  accountNameById?: Record<string, string>;
};

function accountDisplay(
  study: TreasuryStudyRow,
  accountNameById?: Record<string, string>
): string {
  const id = study.scope.accountId;
  const name = accountNameById?.[id];
  return name ?? id;
}

function runwayFromStudy(study: TreasuryStudyRow): CashModelRunwayStatus | null {
  if (study.type !== "cash_model") return null;
  return study.derived_snapshot.runwayStatus ?? null;
}

export function StudyList({
  studies,
  activeId,
  onSelect,
  loading,
  accountNameById,
}: Props) {
  const grouped = useMemo(() => {
    const known = STUDY_REGISTRY.map((e) => ({
      type: e.type,
      label: e.navLabel,
      rows: studies.filter((s) => s.type === e.type),
    }));
    const unknown = studies.filter((s) => !isKnownStudyType(s.type));
    return { known, unknown };
  }, [studies]);

  return (
    <div className="analytics-study-list flex flex-col gap-4 h-full">
      <div>
        <p className="sec-title">Saved Analytics</p>
        <p className="treasury-meta-fine mt-1">
          Load a saved study. Create new work in Cash Model or Spend plan.
        </p>
      </div>
      {loading ? (
        <p className="treasury-meta-fine">Loading…</p>
      ) : studies.length === 0 ? (
        <p className="treasury-meta text-sm">
          No saved studies yet. Author in Cash Model or Spend plan, then save.
        </p>
      ) : (
        <div className="flex flex-col gap-4 overflow-y-auto">
          {grouped.known.map((g) =>
            g.rows.length === 0 ? null : (
              <div key={g.type} className="space-y-2">
                <p className="treasury-meta">{g.label}</p>
                <ul className="flex flex-col gap-1">
                  {g.rows.map((s) => {
                    const active = s.id === activeId;
                    const runway = runwayFromStudy(s);
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm"
                          style={{
                            border: "1px solid var(--line)",
                            background: active
                              ? "var(--sealed-bone, #DED9D1)"
                              : "transparent",
                          }}
                          onClick={() => onSelect(s.id)}
                        >
                          <span className="font-medium block flex items-center gap-2 flex-wrap">
                            {s.name}
                            {s.is_primary ? (
                              <span className="chip prov-pulled text-xs">primary</span>
                            ) : null}
                            {runway ? (
                              <CashModelRunwayChip status={runway} compact />
                            ) : null}
                          </span>
                          <span className="treasury-meta-fine block">
                            {accountDisplay(s, accountNameById)}
                          </span>
                          <span className="treasury-meta-fine block">
                            Updated {new Date(s.updated_at).toLocaleString()}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )
          )}
          {grouped.unknown.length > 0 ? (
            <div className="space-y-2">
              <p className="treasury-meta">Other</p>
              <ul className="flex flex-col gap-1">
                {grouped.unknown.map((s) => (
                  <li key={s.id}>
                    <div
                      className="w-full text-left px-3 py-2 text-sm"
                      style={{
                        border: "1px solid var(--line)",
                        opacity: 0.7,
                      }}
                      aria-disabled
                      title="Unknown study type — cannot open in an editor"
                    >
                      <span className="font-medium block">{s.name}</span>
                      <span className="treasury-meta-fine block">
                        {studyTypeLabel(s.type)} ·{" "}
                        {accountDisplay(s, accountNameById)}
                      </span>
                      <span className="treasury-meta-fine block">
                        Unsupported type — view only
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
