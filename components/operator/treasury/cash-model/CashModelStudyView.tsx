"use client";

import { TreasuryCashModelPanel } from "@/components/operator/treasury/TreasuryCashModelPanel";
import { useCashModel } from "@/components/operator/treasury/cash-model/useCashModel";
import type { CashModelStudyRow } from "@/lib/treasury/studies";

type Props = {
  clientUserId: string;
  accounts: { id: string; name: string }[];
  accountId: string;
  onAccountIdChange: (id: string) => void;
  study: CashModelStudyRow;
};

/** Studies tab — cash_model row selected from study list. */
export function CashModelStudyView({
  clientUserId,
  accounts,
  accountId,
  onAccountIdChange,
  study,
}: Props) {
  const model = useCashModel(clientUserId, accountId, study);
  return (
    <TreasuryCashModelPanel
      clientUserId={clientUserId}
      accounts={accounts}
      accountId={accountId}
      onAccountIdChange={onAccountIdChange}
      model={model}
      embedded
    />
  );
}
