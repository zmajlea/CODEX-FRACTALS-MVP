"use client";

import { useCallback, useEffect, useState } from "react";

type DocRow = {
  id: string;
  title: string;
  kind: string;
  analytics_id: string | null;
  print_path: string | null;
  created_at: string;
};

/** Spec B10 Part E — list PDFs / print exports shared with the client. */
export function TreasuryClientDocuments() {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/treasury/documents");
      const json = (await res.json()) as {
        documents?: DocRow[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Failed to load documents");
      setDocs(json.documents ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="treasury-meta">Loading documents…</p>;
  }
  if (error) {
    return (
      <p className="treasury-meta cm-err" role="alert">
        {error}
      </p>
    );
  }
  if (docs.length === 0) {
    return (
      <p className="treasury-meta">
        No documents yet. When your Summit team shares a board PDF, it will
        appear here.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {docs.map((d) => (
        <li
          key={d.id}
          className="panel p-3 flex flex-wrap items-center justify-between gap-2"
        >
          <div>
            <p className="sec-title text-sm mb-0">{d.title}</p>
            <p className="treasury-meta text-xs">
              {new Date(d.created_at).toLocaleDateString()}
            </p>
          </div>
          {d.print_path ? (
            <a
              className="chip"
              href={d.print_path}
              target="_blank"
              rel="noreferrer"
            >
              Open
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
