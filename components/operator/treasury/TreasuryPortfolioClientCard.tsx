import Link from "next/link";
import { formatTreasuryAsOf, formatTreasuryMoney } from "@/lib/treasury/format";
import { isDemoPortfolioInstrument } from "@/lib/treasury/is-demo-tenant";
import type { OperatorTreasuryClientRow } from "@/components/operator/OperatorTreasuryPortfolio";

function primaryCashDisplay(row: OperatorTreasuryClientRow): string {
  const entries = Object.entries(row.total_cash_by_currency ?? {});
  if (entries.length === 1) {
    return formatTreasuryMoney(entries[0]![1], entries[0]![0]);
  }
  if (entries.length > 1) {
    return entries
      .map(([cur, amt]) => formatTreasuryMoney(amt, cur))
      .join(" · ");
  }
  return formatTreasuryMoney(row.total_cash, "USD");
}

function importFoot(row: OperatorTreasuryClientRow): string {
  const n = row.account_count;
  const acct = `${n} account${n === 1 ? "" : "s"}`;
  const when = formatTreasuryAsOf(row.last_synced_at);
  return `${acct}, imported ${when}`;
}

const ATTN_FLAME = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M12 3.5c2 3 5 4.5 5 8.5a5 5 0 0 1-10 0c0-1.6.6-2.7 1.4-3.7.3 1 .9 1.7 1.8 2 .2-2.8 1-4.9.8-6.8Z" />
  </svg>
);

type Props = {
  row: OperatorTreasuryClientRow;
  demo?: boolean;
};

export function TreasuryPortfolioClientCard({ row, demo = false }: Props) {
  const attn = Boolean(row.attention_reason?.trim());
  const industry = row.industry?.trim();
  const nextNote = row.next_note?.trim();
  const watchNote = row.watch_note?.trim();
  const openable = isDemoPortfolioInstrument(demo, row.client_email);
  const href = `/operator/treasury/clients/${row.client_user_id}`;
  const className = `clcard${attn ? " attn" : ""}`;

  const body = (
    <>
      <div className="cl-head">
        <div>
          <div className="cl-name">{row.client_name}</div>
          {industry ? <div className="cl-ind">{industry}</div> : null}
        </div>
        <span className="lens-pills">
          <span className="lens-pill" title="Operator access">
            OP
          </span>
          <span className="lens-pill" title="Client access">
            Client
          </span>
        </span>
      </div>
      <div className="cl-stats">
        <div className="cl-stat">
          <span className="cl-stat-l">Cash position</span>
          <span className="cl-stat-n num">{primaryCashDisplay(row)}</span>
        </div>
        <div className="cl-stat rev">
          <span className="cl-stat-l">To review</span>
          <span className="cl-stat-n num">{row.needs_label_count ?? 0}</span>
        </div>
      </div>
      {nextNote || watchNote ? (
        <div className="cl-rows">
          {nextNote ? (
            <div className="cl-r">
              <span className="cl-k">Next</span>
              <span className="cl-v">{nextNote}</span>
            </div>
          ) : null}
          {watchNote ? (
            <div className="cl-r">
              <span className="cl-k">Watch</span>
              <span className="cl-v">{watchNote}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="cl-foot">
        {attn ? (
          <span className="cl-attn">
            {ATTN_FLAME}
            {row.attention_reason}
          </span>
        ) : (
          <span className="cl-refresh">{importFoot(row)}</span>
        )}
        <span className="cl-open">{openable ? "Open record ›" : "Record built on FFM"}</span>
      </div>
    </>
  );

  if (openable) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }

  return <div className={className}>{body}</div>;
}
