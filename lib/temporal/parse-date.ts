import type { TemporalObjectKind } from "@/lib/database.types";

/** Best-effort ISO date (YYYY-MM-DD) from title/body for relational queries. */
export function inferParsedDate(
  category: string,
  title: string,
  body: string,
  modelDate?: string | null
): string | null {
  if (modelDate) {
    const d = normalizeIsoDate(modelDate);
    if (d) return d;
  }

  if (category.toLowerCase() !== "date") {
    return null;
  }

  for (const source of [body, title]) {
    const d = parseLooseDate(source);
    if (d) return d;
  }
  return null;
}

function normalizeIsoDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(trimmed);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseLooseDate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const iso = trimmed.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const d = new Date(trimmed);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function categoryToKind(category: string): TemporalObjectKind {
  const c = category.toLowerCase();
  if (c === "date") return "date";
  if (c === "party") return "party";
  if (c === "obligation" || c === "milestone") return "obligation";
  if (c === "financial") return "amount";
  if (c === "warning") return "other";
  return "other";
}
