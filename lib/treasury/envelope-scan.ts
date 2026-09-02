/** Spec B12 — client-forbidden token scanner (server-authoritative). */

export type EnvelopeViolation = {
  code: string;
  message: string;
  match?: string;
};

const DENY_PATTERNS: Array<{ code: string; pattern: RegExp; message: string }> = [
  { code: "internal_codename", pattern: /\bR1\s*Gate\b/i, message: "Internal codename not allowed" },
  { code: "ledger_row", pattern: /\bledger\s+row/i, message: "Raw ledger references not allowed" },
  { code: "operator_email", pattern: /\btim@/i, message: "Operator email not allowed" },
  { code: "tenant_internal", pattern: /\btenant[_\s-]?id\b/i, message: "Tenant internals not allowed" },
  { code: "raw_tx_array", pattern: /\[\s*\{[^}]*"amount"\s*:/i, message: "Raw transaction arrays not allowed" },
  { code: "supabase_ref", pattern: /\bsupabase\b/i, message: "Infrastructure references not allowed" },
];

export function scanEnvelope(text: string): EnvelopeViolation[] {
  if (!text.trim()) return [];
  const violations: EnvelopeViolation[] = [];
  for (const rule of DENY_PATTERNS) {
    const m = text.match(rule.pattern);
    if (m) {
      violations.push({
        code: rule.code,
        message: rule.message,
        match: m[0],
      });
    }
  }
  return violations;
}

export function scanEnvelopeFields(
  fields: Array<{ id: string; text: string }>
): Array<EnvelopeViolation & { field: string }> {
  const out: Array<EnvelopeViolation & { field: string }> = [];
  for (const f of fields) {
    for (const v of scanEnvelope(f.text)) {
      out.push({ ...v, field: f.id });
    }
  }
  return out;
}
