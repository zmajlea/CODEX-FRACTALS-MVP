"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { TreasuryInboxItem } from "@/lib/treasury/types";
import { isDemoTenant } from "@/lib/treasury/is-demo-tenant";

type Props = {
  tenantId: string;
  domainSlug: string;
};

function inboxChipClass(kind: TreasuryInboxItem["kind"]): string {
  switch (kind) {
    case "Answered":
      return "answered";
    case "Accepted":
      return "accepted";
    case "Declined":
      return "declined";
    default:
      return "inprogress";
  }
}

export function OperatorTreasuryInbox({ tenantId, domainSlug }: Props) {
  const [items, setItems] = useState<TreasuryInboxItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const demo = isDemoTenant(domainSlug);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/operator/treasury/inbox?tenantId=${tenantId}`);
    if (res.ok) {
      const data = (await res.json()) as {
        items: TreasuryInboxItem[];
        unreadCount: number;
      };
      setItems(data.items);
      setUnreadCount(data.unreadCount);
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Failed to load inbox");
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markSeen(recommendationId: string) {
    await fetch("/api/operator/treasury/inbox", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_seen", recommendation_id: recommendationId }),
    });
    void load();
  }

  return (
    <section className="view on" aria-label="Treasury inbox">
      <div className="hubhead">
        <div>
          <div className="eyebrow">Portfolio</div>
          <h1 className="title">Inbox</h1>
        </div>
      </div>

      {demo ? (
        <span className="illus">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 3.5 19 6v6c0 4.4-3 7.4-7 8.7C8 19.4 5 16.4 5 12V6l7-2.5Z" />
          </svg>
          Illustrative data, from the sample books
        </span>
      ) : null}

      {loading ? (
        <p className="text-sm text-codex-muted">Loading inbox…</p>
      ) : error ? (
        <p className="panel-note text-cinnabar mb-4" role="alert">
          {error}
        </p>
      ) : unreadCount === 0 && items.length === 0 ? (
        <p className="rec-empty">All caught up</p>
      ) : (
        <>
          <p className="inbox-count num" aria-live="polite">
            {unreadCount} unread across your records
          </p>
          <p className="inbox-promise">
            Across every record. Each item opens the record it points to; the status you see here is
            always the live one.
          </p>

          {items.length === 0 ? (
            <p className="rec-empty">All caught up</p>
          ) : (
            <div className="inbox-list">
              {items.map((item) => (
                <Link
                  key={item.id}
                  href={`/operator/treasury/clients/${item.clientUserId}?tab=recommendations`}
                  className="inbox-item"
                  onClick={() => {
                    if (item.unread) void markSeen(item.recommendationId);
                  }}
                >
                  <span className="ib-chip">
                    <span className={`chip ${inboxChipClass(item.kind)}`}>
                      <span className="dot" />
                      {item.kind}
                    </span>
                  </span>
                  <span className="ib-b">
                    <span className="ib-client">{item.clientName}</span>
                    <span className="ib-act">{item.act}</span>
                    {item.snip ? <span className="ib-snip">{item.snip}</span> : null}
                  </span>
                  <span className="ib-go" aria-hidden>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      <p className="meta" style={{ marginTop: 18 }}>
        Each row opens the record it points to, at the place the action landed. The status here is
        read live, not a frozen copy; that is different from the client-facing evidence in
        Recommendations, which is a deliberate snapshot.
      </p>
    </section>
  );
}
