"use client";

import type { TreasuryStudyRow } from "@/lib/treasury/studies";

type Props = {
  studies: TreasuryStudyRow[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  loading?: boolean;
};

function scopeLabel(study: TreasuryStudyRow): string {
  const acct = study.scope.accountId;
  const label = study.scope.label;
  return label ? `${acct} · ${label}` : acct;
}

export function StudyList({
  studies,
  activeId,
  onSelect,
  onNew,
  loading,
}: Props) {
  return (
    <div className="analytics-study-list flex flex-col gap-2 h-full">
      <div className="flex items-center justify-between gap-2">
        <p className="sec-title">Studies</p>
        <button type="button" className="chip" onClick={onNew}>
          New study
        </button>
      </div>
      {loading ? (
        <p className="treasury-meta-fine">Loading…</p>
      ) : studies.length === 0 ? (
        <p className="treasury-meta text-sm">
          No saved studies yet. Author live, then Save to freeze a snapshot.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 overflow-y-auto">
          {studies.map((s) => {
            const active = s.id === activeId;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className="w-full text-left px-2 py-2 text-sm"
                  style={{
                    border: "1px solid var(--line)",
                    background: active ? "var(--sealed-bone, #DED9D1)" : "transparent",
                  }}
                  onClick={() => onSelect(s.id)}
                >
                  <span className="font-medium block">{s.name}</span>
                  <span className="treasury-meta-fine block">
                    {s.type.replace("_", " ")} · {scopeLabel(s)}
                  </span>
                  <span className="treasury-meta-fine block">
                    Updated {new Date(s.updated_at).toLocaleString()}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
