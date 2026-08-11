"use client";

import {
  CASH_MODEL_BUCKET_KEYS,
  type CashModelBucketKey,
} from "@/lib/treasury/cash-model-types";
import { defaultBucketForLabel } from "@/lib/treasury/cash-model";
import type { MonthlyByCategorySeries } from "@/lib/treasury/load-monthly-by-category";

type Props = {
  categorySeries: MonthlyByCategorySeries | null | undefined;
  bucketMap: Record<string, CashModelBucketKey>;
  onChange: (label: string, bucket: CashModelBucketKey | null) => void;
};

const EDITABLE_BUCKETS: CashModelBucketKey[] = CASH_MODEL_BUCKET_KEYS.filter(
  (b) => !b.startsWith("uncategorized")
);

function labelDirection(
  series: MonthlyByCategorySeries,
  label: string
): "in" | "out" {
  let inn = 0;
  let out = 0;
  for (const cell of Object.values(series[label] ?? {})) {
    inn += cell.in ?? 0;
    out += cell.out ?? 0;
  }
  return inn >= out ? "in" : "out";
}

/**
 * Spec 65-R Block 1 — Category → bucket editor.
 * Name-match defaults chipped prov-assumed; overrides chipped prov-user-provided.
 */
export function CashModelBucketMapEditor({
  categorySeries,
  bucketMap,
  onChange,
}: Props) {
  const labels = Object.keys(categorySeries ?? {})
    .filter((l) => l !== "__uncategorized__")
    .sort((a, b) => a.localeCompare(b));

  if (!categorySeries || labels.length === 0) {
    return (
      <div className="panel p-3" style={{ border: "1px solid var(--line)" }}>
        <p className="sec-title">Category → bucket</p>
        <p className="treasury-meta text-sm">
          No labeled categories yet — label transactions or add rules to populate
          this map.
        </p>
      </div>
    );
  }

  return (
    <div className="panel p-3 space-y-2" style={{ border: "1px solid var(--line)" }}>
      <p className="sec-title">Category → bucket</p>
      <p className="treasury-meta-fine">
        Map each label to a Tim bucket. Without a map, factors only move labels
        that name-match the taxonomy.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="treasury-meta text-left">
              <th className="py-1 pr-3">Label</th>
              <th className="py-1 pr-3">Bucket</th>
              <th className="py-1">Source</th>
            </tr>
          </thead>
          <tbody>
            {labels.map((label) => {
              const dir = labelDirection(categorySeries, label);
              const assumed = defaultBucketForLabel(label, dir);
              const override = bucketMap[label];
              const resolved = override ?? assumed;
              const isOverride = override != null;
              return (
                <tr key={label} className="border-t border-[var(--line)]">
                  <td className="py-2 pr-3">{label}</td>
                  <td className="py-2 pr-3">
                    <select
                      className="field-input text-xs w-auto min-w-[9rem]"
                      value={resolved}
                      onChange={(e) => {
                        const next = e.target.value as CashModelBucketKey;
                        // Clearing back to name-match default removes the override entry.
                        if (next === assumed) onChange(label, null);
                        else onChange(label, next);
                      }}
                    >
                      {EDITABLE_BUCKETS.map((b) => (
                        <option key={b} value={b}>
                          {b.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2">
                    <span
                      className={`chip ${
                        isOverride ? "prov-user-provided" : "prov-assumed"
                      }`}
                    >
                      {isOverride ? "user-provided" : "assumed"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
