"use client";

import type { PortfolioTemporalObject } from "@/lib/temporal/portfolio-fetch";

function haystack(obj: PortfolioTemporalObject): string {
  return [
    obj.eventType,
    obj.qualifier,
    obj.composedLabel,
    obj.title,
    obj.parsedDate,
    obj.category,
    obj.body,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Sealed-only local filter — each whitespace token must appear in eventType,
 * qualifier, date, or related fields.
 */
export function filterSealedPulses(
  objects: PortfolioTemporalObject[],
  query: string
): PortfolioTemporalObject[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return objects;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const sealed = objects.filter((o) => o.isSealed && !o.isLocked);

  return sealed.filter((obj) => {
    const text = haystack(obj);
    return tokens.every((token) => text.includes(token));
  });
}

export function applyVaultQueryView(
  objects: PortfolioTemporalObject[],
  query: string
): PortfolioTemporalObject[] {
  const normalized = query.trim();
  if (!normalized) return objects;
  return filterSealedPulses(objects, normalized);
}
