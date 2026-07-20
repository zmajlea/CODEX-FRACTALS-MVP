import Link from "next/link";

const TAB_LABELS: Record<string, string> = {
  profile: "Profile",
  connections: "Connections",
  transactions: "Transactions",
  rules: "Rules",
  summary: "Summary",
  analytics: "Analyzer",
  recommendations: "Recommendations",
};

type Props = {
  clientUserId: string;
  clientName: string;
  tab: string;
};

/** Ana overview.html:63 — Portfolio Dashboard › {client} [› {tab}] */
export function TreasuryRecordCrumb({ clientUserId, clientName, tab }: Props) {
  const tail = tab === "overview" ? null : TAB_LABELS[tab];
  const recordHref = `/operator/treasury/clients/${clientUserId}?tab=overview`;

  return (
    <div className="crumb">
      <Link href="/operator/treasury">Portfolio Dashboard</Link>
      <span className="sep">›</span>
      {tail ? (
        <Link href={recordHref}>{clientName}</Link>
      ) : (
        <span>{clientName}</span>
      )}
      {tail ? (
        <>
          <span className="sep">›</span>
          <span>{tail}</span>
        </>
      ) : null}
    </div>
  );
}
