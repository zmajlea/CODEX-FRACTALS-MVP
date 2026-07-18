"use client";

/**
 * Stage 8b-2 — single shared optimistic pick handler for every PickButton.
 * Instantiate once on OperatorTreasuryClientRecord; pass `pick` everywhere.
 */

import { useCallback, useState } from "react";
import {
  postPickableToDraft,
  postTransactionIdsToDraft,
} from "@/lib/treasury/post-pickable";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";

export type OptimisticPickPayload = {
  token: number;
  draftKind: DraftKind;
  pickable: Pickable;
};

export function useOptimisticPick(
  clientUserId: string,
  onSettled: () => void
) {
  const [optimisticPick, setOptimisticPick] =
    useState<OptimisticPickPayload | null>(null);
  const [pickNotice, setPickNotice] = useState<string | null>(null);

  const clearNotice = useCallback(() => setPickNotice(null), []);

  const pick = useCallback(
    async (draftKind: DraftKind, pickable: Pickable) => {
      const token = Date.now();
      setOptimisticPick({ token, draftKind, pickable });
      setPickNotice(null);
      try {
        const result = await postPickableToDraft(
          clientUserId,
          draftKind,
          pickable
        );
        setOptimisticPick(null);
        if (result.duplicate) {
          setPickNotice(
            `Already added to this ${draftKind === "question" ? "question" : "recommendation"}.`
          );
          return;
        }
        onSettled();
      } catch (e) {
        setOptimisticPick(null);
        setPickNotice(
          e instanceof Error ? e.message : "Failed to add to draft"
        );
      }
    },
    [clientUserId, onSettled]
  );

  /** Bulk ledger selection — same settle/duplicate path, no per-row optimistic spam. */
  const pickTransactions = useCallback(
    async (draftKind: DraftKind, transactionIds: string[]) => {
      if (transactionIds.length === 0) return;
      setPickNotice(null);
      const label =
        transactionIds.length === 1
          ? "1 transaction"
          : `${transactionIds.length} transactions`;
      const token = Date.now();
      setOptimisticPick({
        token,
        draftKind,
        pickable: {
          kind: "transaction",
          ref: transactionIds[0],
          label,
          sublabel: "selection",
        },
      });
      try {
        const result = await postTransactionIdsToDraft(
          clientUserId,
          draftKind,
          transactionIds
        );
        setOptimisticPick(null);
        if (result.duplicate) {
          setPickNotice(
            `Already added to this ${draftKind === "question" ? "question" : "recommendation"}.`
          );
          return;
        }
        onSettled();
      } catch (e) {
        setOptimisticPick(null);
        setPickNotice(
          e instanceof Error ? e.message : "Failed to add to draft"
        );
      }
    },
    [clientUserId, onSettled]
  );

  return {
    pick,
    pickTransactions,
    optimisticPick,
    pickNotice,
    clearNotice,
  };
}
