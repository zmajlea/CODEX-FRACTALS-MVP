"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BcnIcon } from "@/components/bcn/BcnIcon";
import type { TreasuryInboxItem } from "@/lib/treasury/types";

type Props = {
  tenantId: string;
};

export function OperatorTreasuryInbox({ tenantId }: Props) {
  const [items, setItems] = useState<TreasuryInboxItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    <section aria-label="Treasury inbox">
      <div className="hubhead mb-4">
        <div>
          <div className="eyebrow">Practice</div>
          <h1 className="title">Inbox</h1>
          <p className="text-sm text-codex-muted mt-1">
            {unreadCount > 0 ? (
              <>
                <b>{unreadCount}</b> unread across your records
              </>
            ) : (
              "All caught up"
            )}
          </p>
        </div>
      </div>

      <p className="ibx-sub">
        Across every record. Each item opens the record it points to; the status you see here is
        always the live one.
      </p>

      {error ? (
        <p className="panel-note text-cinnabar mb-4" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-codex-muted">Loading inbox…</p>
      ) : items.length === 0 ? (
        <p className="rec-empty">Nothing needs your attention right now.</p>
      ) : (
        <div className="ibx-list">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/operator/treasury/clients/${item.clientUserId}?tab=recommendations`}
              className={`ibx-row${item.unread ? " unread" : ""}${item.actioned ? " actioned" : ""}`}
              onClick={() => {
                if (item.unread) void markSeen(item.recommendationId);
              }}
            >
              <span className="ibx-ic">
                <BcnIcon name={item.kind === "Declined" ? "compass" : item.kind === "Answered" ? "out" : "shield"} />
              </span>
              <span className="ibx-b">
                <span className="ibx-k">{item.kind}</span>
                <span className="ibx-t">{item.title}</span>
                {item.sub ? <span className="ibx-s">{item.sub}</span> : null}
              </span>
              <span className="ibx-meta flex items-center gap-2">
                {item.unread ? <span className="ibx-dot" title="Unread" /> : null}
                <BcnIcon name="out" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
