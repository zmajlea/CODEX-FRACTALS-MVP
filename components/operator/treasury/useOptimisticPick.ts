"use client";

/**
 * Spec 43 — single shared pick handler (POST → settle reload).
 * Optimistic *insert* removed; delete on the rail stays optimistic.
 * Instantiate once on OperatorTreasuryClientRecord; pass `pick` everywhere.
 */

import { useCallback, useState } from "react";
import {
  postPickableToDraft,
  postTransactionIdsToDraft,
  type PostPickResult,
} from "@/lib/treasury/post-pickable";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import { onEvidencePickSettled } from "@/lib/treasury/drafts-drawer-session";

const EMPTY_RESULT: PostPickResult = { duplicate: false };

export function useOptimisticPick(
  clientUserId: string,
  onSettled: () => void
) {
  const [pickNotice, setPickNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const clearNotice = useCallback(() => setPickNotice(null), []);

  const pick = useCallback(
    async (draftKind: DraftKind, pickable: Pickable) => {
      setPickNotice(null);
      setPicking(true);
      try {
        const result =
          (await postPickableToDraft(clientUserId, draftKind, pickable)) ??
          EMPTY_RESULT;
        if (result?.duplicate) {
          setPickNotice(
            `Already added to this ${draftKind === "question" ? "question" : "recommendation"}.`
          );
          return;
        }
        onEvidencePickSettled(draftKind);
        onSettled();
      } catch (e) {
        setPickNotice(
          e instanceof Error ? e.message : "Failed to add to draft"
        );
      } finally {
        setPicking(false);
      }
    },
    [clientUserId, onSettled]
  );

  /** Bulk ledger selection — hits postTransactionIdsToDraft (Symptom 1 suspect). */
  const pickTransactions = useCallback(
    async (draftKind: DraftKind, transactionIds: string[]) => {
      if (transactionIds.length === 0) return;
      setPickNotice(null);
      setPicking(true);
      try {
        const result =
          (await postTransactionIdsToDraft(
            clientUserId,
            draftKind,
            transactionIds
          )) ?? EMPTY_RESULT;
        if (result?.duplicate) {
          setPickNotice(
            `Already added to this ${draftKind === "question" ? "question" : "recommendation"}.`
          );
          return;
        }
        onEvidencePickSettled(draftKind);
        onSettled();
      } catch (e) {
        setPickNotice(
          e instanceof Error ? e.message : "Failed to add to draft"
        );
      } finally {
        setPicking(false);
      }
    },
    [clientUserId, onSettled]
  );

  const setNotice = useCallback((msg: string | null) => {
    setPickNotice(msg);
  }, []);

  return {
    pick,
    pickTransactions,
    /** @deprecated Spec 43 — insert optimism removed; always null. */
    optimisticPick: null as null,
    pickNotice,
    clearNotice,
    setNotice,
    picking,
  };
}
