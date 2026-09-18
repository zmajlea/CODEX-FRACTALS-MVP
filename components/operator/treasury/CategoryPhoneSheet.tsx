"use client";

import { useMemo, useState } from "react";
import { RulePhonePortal } from "@/components/operator/treasury/RulePhonePortal";

type Props = {
  open: boolean;
  onClose: () => void;
  categories: string[];
  value: string;
  onPick: (label: string) => void;
  /** Optional recent labels shown first (notes: Recently used). */
  recent?: string[];
};

export function CategoryPhoneSheet({
  open,
  onClose,
  categories,
  value,
  onPick,
  recent = [],
}: Props) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();

  const recentFiltered = useMemo(
    () =>
      recent.filter(
        (c) => categories.includes(c) && (!query || c.toLowerCase().includes(query))
      ),
    [recent, categories, query]
  );

  const matches = useMemo(
    () =>
      categories.filter(
        (c) =>
          (!query || c.toLowerCase().includes(query)) &&
          !recentFiltered.includes(c)
      ),
    [categories, query, recentFiltered]
  );

  const exact = categories.some((c) => c.toLowerCase() === query);
  const showNew = Boolean(query && !exact);

  return (
    <RulePhonePortal open={open} className="rm-overlay--stack" aria-label="Assign category">
      <div className="rm-sheet">
        <div className="rm-appbar">
          <button type="button" className="rm-ic" onClick={onClose} aria-label="Cancel">
            ×
          </button>
          <div className="rm-ttl">
            <h2>Assign category</h2>
          </div>
        </div>
        <div className="rm-body">
          <input
            className="rm-search"
            type="search"
            placeholder="Search categories"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          {showNew ? (
            <button
              type="button"
              className="rm-catrow"
              onClick={() => {
                onPick(q.trim());
                onClose();
              }}
            >
              Use “{q.trim()}”
            </button>
          ) : null}
          {recentFiltered.length > 0 ? (
            <>
              <div className="rm-card" style={{ padding: "8px 12px" }}>
                <div className="rm-k">Recently used</div>
                {recentFiltered.map((c) => (
                  <button
                    key={`r-${c}`}
                    type="button"
                    className="rm-catrow"
                    onClick={() => {
                      onPick(c);
                      onClose();
                    }}
                  >
                    {c}
                    {c === value ? " ·" : ""}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <div className="rm-card" style={{ padding: "8px 12px" }}>
            <div className="rm-k">All categories</div>
            {matches.length === 0 && !showNew ? (
              <p className="rm-hint">No categories match.</p>
            ) : (
              matches.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="rm-catrow"
                  onClick={() => {
                    onPick(c);
                    onClose();
                  }}
                >
                  {c}
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </RulePhonePortal>
  );
}
