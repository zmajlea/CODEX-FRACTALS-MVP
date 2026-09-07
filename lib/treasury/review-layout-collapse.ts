/**
 * Spec B17 M2 — layout collapse for client (and study) read.
 * Store raw w; project groupings at render. h ignored.
 */

import { resolveLayout, type ReviewBlockLayout } from "@/lib/treasury/review-block-layout";

export type CollapseRole = "figure" | "exhibit" | "note" | "narrative" | "study" | "other";

export type CollapseItem = {
  id: string;
  role: CollapseRole;
  layout: ReviewBlockLayout;
  /** Original index / payload key for renderers. */
  sourceIndex: number;
};

export type CollapseUnit =
  | { kind: "figrow"; items: CollapseItem[] }
  | { kind: "r84"; primary: CollapseItem; side: CollapseItem }
  | { kind: "r66"; left: CollapseItem; right: CollapseItem }
  | { kind: "full"; item: CollapseItem };

function isFigureTile(item: CollapseItem): boolean {
  return item.role === "figure" || (item.role === "exhibit" && item.layout.w <= 3);
}

/**
 * Walk blocks in order applying mockup collapse rules:
 * - consecutive figures (w≤3) → figrow of ≤4
 * - exhibit+note summing to 12 → r84 (2:1)
 * - two exhibits both w===6 → r66
 * - else full width
 */
export function collapseLayoutUnits(items: CollapseItem[]): CollapseUnit[] {
  const units: CollapseUnit[] = [];
  let i = 0;
  while (i < items.length) {
    const b = items[i]!;
    if (isFigureTile(b)) {
      const grp: CollapseItem[] = [];
      while (i < items.length && isFigureTile(items[i]!) && grp.length < 4) {
        grp.push(items[i]!);
        i += 1;
      }
      units.push({ kind: "figrow", items: grp });
      continue;
    }

    const nxt = items[i + 1];
    if (
      b.role === "exhibit" &&
      nxt &&
      nxt.role === "note" &&
      b.layout.w + nxt.layout.w === 12
    ) {
      units.push({ kind: "r84", primary: b, side: nxt });
      i += 2;
      continue;
    }
    if (
      b.role === "note" &&
      nxt &&
      nxt.role === "exhibit" &&
      b.layout.w + nxt.layout.w === 12
    ) {
      units.push({ kind: "r84", primary: nxt, side: b });
      i += 2;
      continue;
    }
    if (
      b.role === "exhibit" &&
      nxt &&
      nxt.role === "exhibit" &&
      b.layout.w === 6 &&
      nxt.layout.w === 6
    ) {
      units.push({ kind: "r66", left: b, right: nxt });
      i += 2;
      continue;
    }

    units.push({ kind: "full", item: b });
    i += 1;
  }
  return units;
}

export function collapseItemFromBlock(
  block: Record<string, unknown>,
  sourceIndex: number
): CollapseItem {
  const roleRaw = String(block.role ?? "other");
  const role: CollapseRole =
    roleRaw === "figure" ||
    roleRaw === "exhibit" ||
    roleRaw === "note" ||
    roleRaw === "narrative" ||
    roleRaw === "study"
      ? roleRaw
      : "other";
  return {
    id: String(block.id ?? `b-${sourceIndex}`),
    role,
    layout: resolveLayout(block.layout),
    sourceIndex,
  };
}
