export const EVENT_TYPES = [
  "Signing",
  "Filing Due",
  "Reporting Due",
  "Renewal",
  "Amendment",
  "Expiration",
  "Payment Due",
  "Commitment",
  "Decision",
  "Resolution",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);

export function isEventType(value: string): value is EventType {
  return EVENT_TYPE_SET.has(value);
}

export function normalizeEventType(value: string | null | undefined): EventType | "" {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  if (isEventType(trimmed)) return trimmed;
  const match = EVENT_TYPES.find(
    (t) => t.toLowerCase() === trimmed.toLowerCase()
  );
  return match ?? "";
}

export function composeLabel(eventType: string, qualifier: string): string {
  return `${eventType} - ${qualifier}`;
}

export function validateComposedLabel(
  eventType: string,
  qualifier: string
): string | null {
  if (!eventType.trim()) return "Event Type needed before sealing.";
  if (!qualifier.trim()) return "Qualifier needed before sealing.";
  const label = composeLabel(eventType.trim(), qualifier.trim());
  if (label.length > 60) return "Label must be 60 characters or fewer.";
  return null;
}

/** Parse legacy title_ciphertext plaintext into eventType + qualifier. */
export function parseLegacyTitle(title: string | null | undefined): {
  eventType: string;
  qualifier: string;
} {
  if (!title?.trim()) return { eventType: "", qualifier: "" };
  const sep = title.indexOf(" - ");
  if (sep > 0) {
    const maybeType = title.slice(0, sep).trim();
    const qualifier = title.slice(sep + 3).trim();
    if (isEventType(maybeType) || normalizeEventType(maybeType)) {
      return {
        eventType: normalizeEventType(maybeType) || maybeType,
        qualifier,
      };
    }
  }
  return { eventType: "", qualifier: title.trim() };
}

export function resolvePulseLabel(
  eventType: string | null | undefined,
  qualifier: string | null | undefined,
  title: string | null | undefined
): { eventType: string; qualifier: string; composedLabel: string } {
  let et = (eventType ?? "").trim();
  let q = (qualifier ?? "").trim();

  if (!et && !q && title) {
    const parsed = parseLegacyTitle(title);
    et = parsed.eventType;
    q = parsed.qualifier;
  }

  if (!q && title && et) {
    q = title.replace(`${et} - `, "").trim() || title.trim();
  }

  if (!q && title) q = title.trim();
  if (!et && q) et = "";

  const composedLabel =
    et && q ? composeLabel(et, q) : (title?.trim() ?? q) || "Untitled milestone";

  return { eventType: et, qualifier: q, composedLabel };
}
