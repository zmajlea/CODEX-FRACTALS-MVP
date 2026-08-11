/**
 * Spec 65-R Part A — registry-driven Analytics sections.
 * Nav = [Saved Analytics, ...registry]. New study types = a registry entry.
 */

import type { ComponentType } from "react";
import type { StudyType } from "@/lib/treasury/studies";
import type { CashModelRunwayStatus } from "@/lib/treasury/cash-model-types";

export type StudyRegistryEntry = {
  type: StudyType;
  navLabel: string;
  createLabel: string;
  /** View id for AnalyticsView (typed create section). */
  view: "cash_model" | "spend_plan";
  /** Optional summary chip renderer key — cash_model uses runwayStatus. */
  summaryChip: "runwayStatus" | null;
};

export const STUDY_REGISTRY: StudyRegistryEntry[] = [
  {
    type: "cash_model",
    navLabel: "Cash Model",
    createLabel: "Cash model",
    view: "cash_model",
    summaryChip: "runwayStatus",
  },
  {
    type: "spend_plan",
    navLabel: "Spend plan",
    createLabel: "Spend plan",
    view: "spend_plan",
    summaryChip: null,
  },
];

export function registryEntryForType(
  type: string
): StudyRegistryEntry | undefined {
  return STUDY_REGISTRY.find((e) => e.type === type);
}

export function isKnownStudyType(type: string): type is StudyType {
  return STUDY_REGISTRY.some((e) => e.type === type);
}

/** Display label for a study type (known or unknown). */
export function studyTypeLabel(type: string): string {
  return registryEntryForType(type)?.navLabel ?? type.replace(/_/g, " ");
}

export type StudySummaryChipData = {
  runwayStatus?: CashModelRunwayStatus | null;
};

/** Marker type so SavedAnalytics can resolve Panel by type without circular imports. */
export type StudyPanelProps = {
  clientUserId: string;
  accounts: { id: string; name: string }[];
  accountsData: unknown;
  accountId: string;
  onAccountIdChange: (id: string) => void;
  study: unknown;
  clientName?: string;
  onPick?: (draftKind: unknown, pickable: unknown) => void | Promise<void>;
};

export type StudyPanelComponent = ComponentType<StudyPanelProps>;
