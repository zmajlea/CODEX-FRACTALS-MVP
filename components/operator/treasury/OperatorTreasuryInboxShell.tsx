"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BcnContinuityShell } from "@/components/bcn/BcnContinuityShell";
import { defaultWordmark } from "@/components/bcn/brand/BcnBrandMarks";
import { treasuryPortfolioRailGroups } from "@/components/operator/treasury/treasuryPortfolioRail";

type Props = {
  tenantId: string;
  tenantName: string;
  who: string;
  children: ReactNode;
};

export function OperatorTreasuryInboxShell({
  tenantId,
  tenantName,
  who,
  children,
}: Props) {
  const [inboxUnread, setInboxUnread] = useState(0);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/operator/treasury/inbox?tenantId=${tenantId}`);
      if (res.ok) {
        const data = (await res.json()) as { unreadCount?: number };
        if (typeof data.unreadCount === "number") setInboxUnread(data.unreadCount);
      }
    })();
  }, [tenantId]);

  const railGroups = useMemo(
    () => treasuryPortfolioRailGroups({ inboxUnread, active: "inbox" }),
    [inboxUnread]
  );

  return (
    <BcnContinuityShell
      mode="operator"
      dataBrand="summit"
      dataR1
      wordmark={defaultWordmark("summit")}
      homeHref="/operator"
      recordPill={{ primary: "Treasury workspace", secondary: tenantName }}
      who={who}
      keyUnlocked
      railGroups={railGroups}
      showBcnSolutionLine
    >
      {children}
    </BcnContinuityShell>
  );
}
