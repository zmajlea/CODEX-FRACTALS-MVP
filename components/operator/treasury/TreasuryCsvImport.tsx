"use client";

import { useRef, useState } from "react";
import { PickButton } from "@/components/operator/treasury/PickButton";
import type { TreasuryImportReconcile } from "@/lib/treasury/csv-import";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";

type Props = {
  clientUserId: string;
  onImported?: () => void;
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
};

function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function TreasuryCsvImport({ clientUserId, onImported, onPick }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [importingRows, setImportingRows] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accountLabel, setAccountLabel] = useState("");
  const [report, setReport] = useState<TreasuryImportReconcile | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setReport(null);
    const text = await file.text();
    const rowCount = Math.max(
      0,
      text.trim().split(/\r?\n/).filter(Boolean).length - 1
    );
    setImportingRows(rowCount);

    const form = new FormData();
    form.append("file", new File([text], file.name, { type: file.type || "text/csv" }));
    if (accountLabel.trim()) {
      form.append("account_label", accountLabel.trim());
    }
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/import-csv`,
      { method: "POST", body: form }
    );
    const data = (await res.json()) as TreasuryImportReconcile & { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Import failed");
    } else {
      setReport(data);
      onImported?.();
    }
    setBusy(false);
    setImportingRows(null);
  }

  return (
    <div className="csv-import-panel">
      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span className="treasury-meta">Account label (if column empty)</span>
          <input
            type="text"
            className="field-input"
            placeholder="e.g. 0617"
            value={accountLabel}
            onChange={(e) => setAccountLabel(e.target.value)}
            disabled={busy}
          />
        </label>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy
            ? importingRows != null
              ? `Importing ${importingRows.toLocaleString()} rows…`
              : "Importing…"
            : "Import CSV"}
        </button>
        <a className="text-sm underline" href="/docs/treasury-csv-template.csv" download>
          Legacy template
        </a>
        <a
          className="text-sm underline"
          href="/docs/r1-import-contract.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          R1 import contract
        </a>
      </div>
      <p className="treasury-meta-fine mt-2">
        Manual account names and types set by the client stick until a CSV row provides a new
        balance for that account.
      </p>

      {error ? (
        <p className="text-sm mt-3" style={{ color: "var(--su-neg)" }}>
          {error}
        </p>
      ) : null}

      {report ? (
        <div className="panel mt-4 p-4 text-sm" style={{ border: "1px solid var(--line)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="sec-title mb-0">Import reconcile</p>
            {onPick ? (
              <PickButton
                variant="header"
                pickable={{
                  kind: "import",
                  ref: "csv-manual",
                  label: "CSV import reconcile",
                  sublabel: `${report.imported} imported · net $${fmtMoney(report.net)}`,
                  snap: {
                    label: "CSV import reconcile",
                    sublabel: `${report.imported} imported · ${report.dateMin ?? "—"} → ${report.dateMax ?? "—"} · net $${fmtMoney(report.net)}`,
                    rowsRead: report.rowsRead,
                    imported: report.imported,
                    skipped: report.skipped,
                    inflowSum: report.inflowSum,
                    outflowSum: report.outflowSum,
                    net: report.net,
                    dateMin: report.dateMin,
                    dateMax: report.dateMax,
                    signConvention: report.signConvention?.kind ?? null,
                  },
                }}
                onPick={onPick}
              />
            ) : null}
          </div>
          <dl className="grid gap-1 treasury-meta">
            <div>
              <strong>{report.rowsRead}</strong> rows read · <strong>{report.imported}</strong>{" "}
              imported · <strong>{report.skipped}</strong> skipped ·{" "}
              <strong>{report.duplicatesIgnored}</strong> duplicates ignored
            </div>
            <div>
              Inflows <strong>${fmtMoney(report.inflowSum)}</strong> · Outflows{" "}
              <strong>${fmtMoney(report.outflowSum)}</strong> · Net{" "}
              <strong>${fmtMoney(report.net)}</strong>
            </div>
            <div>
              Sign/type mismatches: <strong>{report.signTypeMismatches}</strong> · Rows needing
              direction: <strong>{report.rowsNeedingDirection}</strong>
            </div>
            {report.signConvention ? (
              <div>
                <strong>{report.signConvention.message}</strong>
              </div>
            ) : null}
            <div>
              Date range: {report.dateMin ?? "—"} → {report.dateMax ?? "—"}
            </div>
            <div>
              Accounts:{" "}
              {report.accountsTouched.length > 0
                ? report.accountsTouched.join(", ")
                : "none"}
            </div>
            {Object.keys(report.endBalances).length > 0 ? (
              <div>
                End balances:{" "}
                {Object.entries(report.endBalances)
                  .map(([acct, bal]) => `${acct} $${fmtMoney(bal ?? 0)}`)
                  .join(" · ")}
              </div>
            ) : null}
          </dl>
          {report.warnings.length > 0 ? (
            <ul className="mt-2 treasury-meta-fine list-disc pl-4">
              {report.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          {report.skippedDetails.length > 0 ? (
            <div className="mt-2">
              <button
                type="button"
                className="text-xs underline treasury-meta-fine"
                onClick={() => setShowSkipped((v) => !v)}
              >
                {showSkipped ? "Hide" : "Show"} skipped rows ({report.skippedDetails.length})
              </button>
              {showSkipped ? (
                <ul className="mt-1 max-h-40 overflow-y-auto text-xs treasury-meta-fine list-disc pl-4">
                  {report.skippedDetails.map((s) => (
                    <li key={`${s.row}-${s.reason}`}>
                      Row {s.row}: {s.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
