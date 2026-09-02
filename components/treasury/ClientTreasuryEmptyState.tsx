"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Spec B10 — branded cold start; CSV upload; Plaid stub only. */
export function ClientTreasuryEmptyState() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onUpload(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/treasury/import-csv", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as { error?: string; imported?: number };
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setMessage(`Imported ${json.imported ?? 0} transactions.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="client-wrap max-w-xl mx-auto py-12 space-y-6">
      <div>
        <p className="eyebrow" style={{ letterSpacing: "0.12em" }}>
          Summit Treasury
        </p>
        <h1 className="rh1">Welcome</h1>
        <p className="rh-src">
          Nothing has been shared with you yet. Your advisor will import your
          book, confirm rules, and share dashboards here. You can also upload a
          CSV statement below.
        </p>
      </div>

      <div
        className="panel p-4 space-y-3"
        style={{ border: "1px solid var(--line)" }}
      >
        <p className="sec-title mb-0">Upload statement (CSV)</p>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
        />
        {message ? <p className="treasury-meta text-sm">{message}</p> : null}
        {error ? (
          <p className="treasury-meta cm-err" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div
        className="panel p-4 space-y-2 opacity-70"
        style={{ border: "1px solid var(--line)" }}
      >
        <p className="sec-title mb-0">Connect your bank</p>
        <p className="treasury-meta text-sm mb-0">Coming soon</p>
        <button type="button" className="chip" disabled>
          Connect your bank (coming soon)
        </button>
      </div>

      <p className="treasury-meta-fine text-xs">
        Advisory only. Figures reflect your ledger as of the last import. Not
        investment, tax, or legal advice.
      </p>
    </div>
  );
}
