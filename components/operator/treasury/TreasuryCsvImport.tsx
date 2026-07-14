"use client";

import { useRef, useState } from "react";

type Props = {
  clientUserId: string;
  onImported?: () => void;
};

export function TreasuryCsvImport({ clientUserId, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setMsg(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/import-csv`,
      { method: "POST", body: form }
    );
    const data = (await res.json()) as {
      imported?: number;
      skipped?: number;
      error?: string;
    };
    if (!res.ok) {
      setMsg(data.error ?? "Import failed");
    } else {
      setMsg(`Imported ${data.imported ?? 0} transactions (${data.skipped ?? 0} skipped).`);
      onImported?.();
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
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
        {busy ? "Importing…" : "Import CSV"}
      </button>
      <a className="text-sm underline" href="/docs/treasury-csv-template.csv" download>
        Download template
      </a>
      <a className="text-sm underline" href="/docs/treasury-csv-format.md" target="_blank" rel="noopener noreferrer">
        Format guide
      </a>
      <p className="w-full text-xs text-codex-muted mt-1">
        Manual account names and types set by the client stick until a CSV row provides a new
        balance for that account.
      </p>
      {msg ? <span className="text-sm text-codex-muted">{msg}</span> : null}
    </div>
  );
}
