export type IntelligenceLensId =
  | "compliance"
  | "architecture"
  | "risk"
  | "commercial"
  | "custom";

export type IntelligenceLens = {
  id: IntelligenceLensId;
  icon: string;
  label: string;
  prompt: string;
};

/** Intelligence Lenses — extraction focus presets (from CODEX_NDA graph workspace). */
export const INTELLIGENCE_LENSES: IntelligenceLens[] = [
  {
    id: "compliance",
    icon: "⏱️",
    label: "Compliance & Deadlines",
    prompt:
      "Extract all hard deadlines, submission dates, RSVP dates, and formatting obligations. Return them as strict Date and Obligation objects.",
  },
  {
    id: "architecture",
    icon: "⚙️",
    label: "System Architecture",
    prompt:
      "Extract all hardware components, operational roles (e.g., Operators, Crew), and facilities/labs. Identify how they connect to each other.",
  },
  {
    id: "risk",
    icon: "⚖️",
    label: "Legal & ITAR Shield",
    prompt:
      "Identify all regulatory classifications (e.g., ITAR/EAR), penalty clauses, termination conditions, and financial liabilities. Flag them as WARNING objects.",
  },
  {
    id: "commercial",
    icon: "📈",
    label: "CRM & Leads",
    prompt:
      "Extract companies, contacts, leads, follow-up actions, deal stages, pricing references, market segments (fotovoltaico, papeleras, smart building), and commercial deadlines. Prefer Entity objects for companies/contacts and Date objects for follow-ups and milestones.",
  },
  {
    id: "custom",
    icon: "✨",
    label: "Custom Prompt",
    prompt: "",
  },
];

export function getLensPrompt(lensId: IntelligenceLensId, customContext?: string): string {
  const lens = INTELLIGENCE_LENSES.find((l) => l.id === lensId);
  if (!lens) return customContext ?? "";
  if (lensId === "custom") return customContext ?? "";
  const extra = customContext?.trim();
  return extra ? `${lens.prompt}\n\nAdditional instructions:\n${extra}` : lens.prompt;
}
