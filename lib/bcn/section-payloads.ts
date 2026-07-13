import type { BcnIconName } from "@/lib/bcn/icons";
import type { BcnSectionPayload } from "@/lib/bcn/sections";

export type BcnContactRow = {
  name: string;
  relationship: string;
  phone: string;
  email: string;
};

export type BcnLabeledFields = Record<string, string>;

export type BcnRoleBlock = {
  label: string;
  icon?: BcnIconName;
  hint?: string;
  fields: BcnLabeledFields;
};

export type PeopleSectionPayload = {
  primaryContact: BcnLabeledFields;
  firstCallTeam: BcnContactRow[];
  additionalContacts: BcnRoleBlock[];
  notes: string;
};

export type AdvisorsSectionPayload = {
  advisors: BcnRoleBlock[];
};

export type LocatorRow = {
  cat: string;
  sub?: string;
  placeholder?: string;
  exists?: "yes" | "no" | "";
  location: string;
};

export type LocatorSectionPayload = { rows: LocatorRow[] };

export type BusinessSectionPayload = {
  dependency: string;
  understandBlocks: BcnRoleBlock[];
  evaluateBlocks: BcnRoleBlock[];
  notes: string;
};

export type TransitionOption = {
  label: string;
  desc: string;
  checked: boolean;
  note: string;
};

export type TransitionSectionPayload = {
  options: TransitionOption[];
  notes: string;
  guidance: string[];
};

export type FinancialSectionPayload = {
  blocks: BcnRoleBlock[];
  notes: string;
};

export type ContinuitySectionPayload = {
  leadershipBlocks: BcnRoleBlock[];
  relationshipBlocks: BcnRoleBlock[];
  overwhelmFirst: string;
  overwhelmThen: string;
  overwhelmFinally: string;
  notes: string;
};

export type DigitalSectionPayload = {
  passwordManager: string;
  digitalVault: string;
  authorizedPerson: string;
  authorizedPhone: string;
  notes: string;
};

export type EmergencySectionPayload = {
  contacts: string[][];
  medical: {
    primaryDoctor: string;
    doctorPhone: string;
    hospital: string;
    bloodType: string;
    allergies: string;
    medications: string;
  };
};

export type FamilySectionPayload = {
  household: string[][];
  pets: string[][];
  vehicles: string[][];
  notes: string;
};

export type ValuesSectionPayload = {
  coreValues: string[];
  experienceNotes: string;
  ratings: Array<{ label: string; value: number }>;
  wishes: {
    organ: string;
    lifeSupport: string;
    burial: string;
    other: string;
  };
  checklist: Array<{ label: string; on: boolean }>;
  documentsWhere: string;
  impactNotes: string;
};

export type StoryPrompt = {
  n: number;
  title: string;
  hint: string;
  body: string;
};

export type StorySectionPayload = {
  prompts: StoryPrompt[];
  letterLead: string;
  letterBody: string;
  people: string[][];
};

export const PEOPLE_PRIMARY_FIELDS = [
  "Name",
  "Relationship",
  "Phone",
  "Email",
] as const;

export const PEOPLE_ADDITIONAL_ROLES: Array<{ label: string }> = [
  { label: "Executor / Personal Representative" },
  { label: "Trustee" },
  { label: "Adult Child" },
];

export const ADVISOR_ROLES: Array<{ label: string; icon: BcnIconName }> = [
  { label: "Operator / Tax Advisor", icon: "scale" },
  { label: "Attorney", icon: "doc" },
  { label: "Financial Advisor", icon: "money" },
  { label: "Insurance Advisor", icon: "shield" },
  { label: "Banker", icon: "building" },
  { label: "Pastor / Spiritual Advisor", icon: "cross" },
];

const ADVISOR_FIELD_KEYS = ["Name", "Firm", "Phone", "Email"] as const;

function emptyFields(keys: readonly string[]): BcnLabeledFields {
  return Object.fromEntries(keys.map((k) => [k, ""]));
}

function roleBlock(label: string, keys: string[], hint?: string): BcnRoleBlock {
  return { label, hint, fields: emptyFields(keys) };
}

function hasRoleBlocks(blocks: BcnRoleBlock[]): boolean {
  return blocks.some((b) => Object.values(b.fields).some((v) => v.trim()));
}

function hasTableRows(rows: string[][]): boolean {
  return rows.some((r) => r.some((c) => c.trim()));
}

export function emptyPeoplePayload(): PeopleSectionPayload {
  return {
    primaryContact: emptyFields(PEOPLE_PRIMARY_FIELDS),
    firstCallTeam: Array.from({ length: 3 }, () => ({
      name: "",
      relationship: "",
      phone: "",
      email: "",
    })),
    additionalContacts: PEOPLE_ADDITIONAL_ROLES.map((role) => ({
      label: role.label,
      fields: emptyFields(PEOPLE_PRIMARY_FIELDS),
    })),
    notes: "",
  };
}

export function emptyAdvisorsPayload(): AdvisorsSectionPayload {
  return {
    advisors: ADVISOR_ROLES.map((role) => ({
      label: role.label,
      icon: role.icon,
      fields: emptyFields(ADVISOR_FIELD_KEYS),
    })),
  };
}

export function emptyLocatorPayload(): LocatorSectionPayload {
  return {
    rows: [
      { cat: "Financial Records", placeholder: "e.g. office file cabinet", location: "" },
      {
        cat: "Legal Documents",
        sub: "Wills, trusts, POA, healthcare directives",
        placeholder: "e.g. attorney's office + home safe",
        location: "",
      },
      { cat: "Insurance Policies", placeholder: "e.g. policy binder", location: "" },
      { cat: "Business Documents", placeholder: "e.g. shop office", location: "" },
      { cat: "Safe / Secure Storage", placeholder: "e.g. home safe", location: "" },
    ],
  };
}

export function emptyBusinessPayload(): BusinessSectionPayload {
  return {
    dependency: "",
    understandBlocks: [
      roleBlock("Person 1", ["Name", "Relationship", "Role"]),
      roleBlock("Person 2", ["Name", "Relationship", "Role"]),
    ],
    evaluateBlocks: [
      roleBlock("Person 1", ["Name", "Relationship", "Role"]),
      roleBlock("Person 2", ["Name", "Relationship", "Role"]),
    ],
    notes: "",
  };
}

export function emptyTransitionPayload(): TransitionSectionPayload {
  return {
    options: [
      {
        label: "Continue Operations",
        desc: "Keep the business running under existing leadership.",
        checked: false,
        note: "",
      },
      {
        label: "Transition Leadership",
        desc: "Hand day-to-day control to a successor inside the business.",
        checked: false,
        note: "",
      },
      {
        label: "Sell the Business",
        desc: "Sell to an outside buyer or the management team.",
        checked: false,
        note: "",
      },
      {
        label: "Wind Down the Business",
        desc: "Close in an orderly way that protects employees.",
        checked: false,
        note: "",
      },
    ],
    notes: "",
    guidance: [
      "Nothing irreversible needs to happen in the first weeks.",
      "Good decisions improve when trusted advisors have time to review options.",
    ],
  };
}

export function emptyFinancialPayload(): FinancialSectionPayload {
  return {
    blocks: [
      roleBlock("Liquid Assets / Cash Accounts", [
        "Primary Institutions",
        "Account Types",
        "Location of Information",
      ]),
      roleBlock("Investment Accounts", [
        "Primary Institutions",
        "Account Types",
        "Location of Information",
      ]),
      roleBlock("Insurance Policies", [
        "Primary Providers",
        "Types of Coverage",
        "Location of Information",
      ]),
    ],
    notes: "",
  };
}

export function emptyContinuityPayload(): ContinuitySectionPayload {
  return {
    leadershipBlocks: [
      roleBlock("CEO / General Manager", ["Name", "Phone", "Email", "Key Responsibilities"]),
      roleBlock("Finance Lead", ["Name", "Phone", "Email", "Key Responsibilities"]),
    ],
    relationshipBlocks: [
      roleBlock("Key customer relationships", ["Name", "Role", "Phone", "Notes"]),
      roleBlock("Key vendor relationships", ["Name", "Role", "Phone", "Notes"]),
    ],
    overwhelmFirst: "",
    overwhelmThen: "",
    overwhelmFinally: "",
    notes: "",
  };
}

export function emptyDigitalPayload(): DigitalSectionPayload {
  return {
    passwordManager: "",
    digitalVault: "",
    authorizedPerson: "",
    authorizedPhone: "",
    notes: "",
  };
}

export function emptyEmergencyPayload(): EmergencySectionPayload {
  return {
    contacts: [
      ["", "", "", ""],
      ["", "", "", ""],
      ["", "", "", ""],
    ],
    medical: {
      primaryDoctor: "",
      doctorPhone: "",
      hospital: "",
      bloodType: "",
      allergies: "",
      medications: "",
    },
  };
}

export function emptyFamilyPayload(): FamilySectionPayload {
  return {
    household: [
      ["", "", ""],
      ["", "", ""],
    ],
    pets: [["", "", ""]],
    vehicles: [["", "", ""]],
    notes: "",
  };
}

export function emptyValuesPayload(): ValuesSectionPayload {
  return {
    coreValues: ["", "", "", "", ""],
    experienceNotes: "",
    ratings: [
      { label: "Providing for my family", value: 0 },
      { label: "Building the business", value: 0 },
      { label: "Helping employees succeed", value: 0 },
      { label: "Serving customers", value: 0 },
    ],
    wishes: { organ: "", lifeSupport: "", burial: "", other: "" },
    checklist: [
      { label: "Last Will & Testament", on: false },
      { label: "Trust Documents", on: false },
      { label: "Financial Power of Attorney", on: false },
      { label: "Healthcare Power of Attorney", on: false },
    ],
    documentsWhere: "",
    impactNotes: "",
  };
}

export function emptyStoryPayload(): StorySectionPayload {
  return {
    prompts: [
      {
        n: 1,
        title: "How did this business begin?",
        hint: "What sacrifices were made? What are you most proud of?",
        body: "",
      },
      {
        n: 2,
        title: "People who helped build this business",
        hint: "Who deserves recognition?",
        body: "",
      },
      {
        n: 3,
        title: "What I loved about running this business",
        hint: "What made the hard days worth it?",
        body: "",
      },
    ],
    letterLead:
      "If you are reading this, something important has happened. More than any document, I want you to remember: you are loved.",
    letterBody: "",
    people: [["", ""]],
  };
}

export function defaultPayloadForSection(sectionId: string): BcnSectionPayload {
  switch (sectionId) {
    case "people":
      return emptyPeoplePayload();
    case "advisors":
      return emptyAdvisorsPayload();
    case "locator":
      return emptyLocatorPayload();
    case "business":
      return emptyBusinessPayload();
    case "transition":
      return emptyTransitionPayload();
    case "financial":
      return emptyFinancialPayload();
    case "continuity":
      return emptyContinuityPayload();
    case "digital":
      return emptyDigitalPayload();
    case "emergency":
      return emptyEmergencyPayload();
    case "family":
      return emptyFamilyPayload();
    case "values":
      return emptyValuesPayload();
    case "story":
      return emptyStoryPayload();
    default:
      return { notes: "" };
  }
}

function mergeRoleBlocks(base: BcnRoleBlock[], raw?: BcnRoleBlock[]): BcnRoleBlock[] {
  return base.map((block, i) => ({
    ...block,
    ...(raw?.[i] ?? {}),
    fields: { ...block.fields, ...(raw?.[i]?.fields ?? {}) },
  }));
}

export function parsePeoplePayload(raw: BcnSectionPayload): PeopleSectionPayload {
  const base = emptyPeoplePayload();
  const p = raw as Partial<PeopleSectionPayload>;
  return {
    primaryContact: { ...base.primaryContact, ...(p.primaryContact ?? {}) },
    firstCallTeam: base.firstCallTeam.map((row, i) => ({
      ...row,
      ...(p.firstCallTeam?.[i] ?? {}),
    })),
    additionalContacts: mergeRoleBlocks(base.additionalContacts, p.additionalContacts),
    notes: typeof p.notes === "string" ? p.notes : "",
  };
}

export function parseAdvisorsPayload(raw: BcnSectionPayload): AdvisorsSectionPayload {
  const base = emptyAdvisorsPayload();
  const p = raw as Partial<AdvisorsSectionPayload>;
  return { advisors: mergeRoleBlocks(base.advisors, p.advisors) };
}

export function parseLocatorPayload(raw: BcnSectionPayload): LocatorSectionPayload {
  const base = emptyLocatorPayload();
  const p = raw as Partial<LocatorSectionPayload>;
  return {
    rows: base.rows.map((row, i) => ({ ...row, ...(p.rows?.[i] ?? {}) })),
  };
}

export function parseBusinessPayload(raw: BcnSectionPayload): BusinessSectionPayload {
  const base = emptyBusinessPayload();
  const p = raw as Partial<BusinessSectionPayload>;
  return {
    dependency: p.dependency ?? base.dependency,
    understandBlocks: mergeRoleBlocks(base.understandBlocks, p.understandBlocks),
    evaluateBlocks: mergeRoleBlocks(base.evaluateBlocks, p.evaluateBlocks),
    notes: p.notes ?? "",
  };
}

export function parseTransitionPayload(raw: BcnSectionPayload): TransitionSectionPayload {
  const base = emptyTransitionPayload();
  const p = raw as Partial<TransitionSectionPayload>;
  return {
    options: base.options.map((opt, i) => ({ ...opt, ...(p.options?.[i] ?? {}) })),
    notes: p.notes ?? "",
    guidance: p.guidance ?? base.guidance,
  };
}

export function parseFinancialPayload(raw: BcnSectionPayload): FinancialSectionPayload {
  const base = emptyFinancialPayload();
  const p = raw as Partial<FinancialSectionPayload>;
  return {
    blocks: mergeRoleBlocks(base.blocks, p.blocks),
    notes: p.notes ?? "",
  };
}

export function parseContinuityPayload(raw: BcnSectionPayload): ContinuitySectionPayload {
  const base = emptyContinuityPayload();
  const p = raw as Partial<ContinuitySectionPayload>;
  return {
    leadershipBlocks: mergeRoleBlocks(base.leadershipBlocks, p.leadershipBlocks),
    relationshipBlocks: mergeRoleBlocks(base.relationshipBlocks, p.relationshipBlocks),
    overwhelmFirst: p.overwhelmFirst ?? "",
    overwhelmThen: p.overwhelmThen ?? "",
    overwhelmFinally: p.overwhelmFinally ?? "",
    notes: p.notes ?? "",
  };
}

export function parseDigitalPayload(raw: BcnSectionPayload): DigitalSectionPayload {
  return { ...emptyDigitalPayload(), ...(raw as Partial<DigitalSectionPayload>) };
}

export function parseEmergencyPayload(raw: BcnSectionPayload): EmergencySectionPayload {
  const base = emptyEmergencyPayload();
  const p = raw as Partial<EmergencySectionPayload>;
  return {
    contacts: p.contacts ?? base.contacts,
    medical: { ...base.medical, ...(p.medical ?? {}) },
  };
}

export function parseFamilyPayload(raw: BcnSectionPayload): FamilySectionPayload {
  const base = emptyFamilyPayload();
  const p = raw as Partial<FamilySectionPayload>;
  return {
    household: p.household ?? base.household,
    pets: p.pets ?? base.pets,
    vehicles: p.vehicles ?? base.vehicles,
    notes: p.notes ?? "",
  };
}

export function parseValuesPayload(raw: BcnSectionPayload): ValuesSectionPayload {
  const base = emptyValuesPayload();
  const p = raw as Partial<ValuesSectionPayload>;
  return {
    coreValues: base.coreValues.map((v, i) => p.coreValues?.[i] ?? v),
    experienceNotes: p.experienceNotes ?? "",
    ratings: base.ratings.map((r, i) => ({ ...r, ...(p.ratings?.[i] ?? {}) })),
    wishes: { ...base.wishes, ...(p.wishes ?? {}) },
    checklist: base.checklist.map((c, i) => ({ ...c, ...(p.checklist?.[i] ?? {}) })),
    documentsWhere: p.documentsWhere ?? "",
    impactNotes: p.impactNotes ?? "",
  };
}

export function parseStoryPayload(raw: BcnSectionPayload): StorySectionPayload {
  const base = emptyStoryPayload();
  const p = raw as Partial<StorySectionPayload>;
  return {
    prompts: base.prompts.map((pr, i) => ({ ...pr, ...(p.prompts?.[i] ?? {}) })),
    letterLead: p.letterLead ?? base.letterLead,
    letterBody: p.letterBody ?? "",
    people: p.people ?? base.people,
  };
}

export function peoplePayloadHasContent(payload: PeopleSectionPayload): boolean {
  if (payload.notes.trim()) return true;
  if (Object.values(payload.primaryContact).some((v) => v.trim())) return true;
  if (payload.firstCallTeam.some((r) => Object.values(r).some((v) => v.trim()))) return true;
  return hasRoleBlocks(payload.additionalContacts);
}

export function advisorsPayloadHasContent(payload: AdvisorsSectionPayload): boolean {
  return hasRoleBlocks(payload.advisors);
}

export function sectionPayloadHasContent(
  sectionId: string,
  raw: BcnSectionPayload
): boolean {
  switch (sectionId) {
    case "people":
      return peoplePayloadHasContent(parsePeoplePayload(raw));
    case "advisors":
      return advisorsPayloadHasContent(parseAdvisorsPayload(raw));
    case "locator":
      return parseLocatorPayload(raw).rows.some(
        (r) => r.location.trim() || r.exists === "yes" || r.exists === "no"
      );
    case "business": {
      const p = parseBusinessPayload(raw);
      return Boolean(p.dependency.trim() || p.notes.trim() || hasRoleBlocks(p.understandBlocks) || hasRoleBlocks(p.evaluateBlocks));
    }
    case "transition": {
      const p = parseTransitionPayload(raw);
      return p.notes.trim().length > 0 || p.options.some((o) => o.checked || o.note.trim());
    }
    case "financial": {
      const p = parseFinancialPayload(raw);
      return p.notes.trim().length > 0 || hasRoleBlocks(p.blocks);
    }
    case "continuity": {
      const p = parseContinuityPayload(raw);
      return (
        p.notes.trim().length > 0 ||
        hasRoleBlocks(p.leadershipBlocks) ||
        hasRoleBlocks(p.relationshipBlocks) ||
        [p.overwhelmFirst, p.overwhelmThen, p.overwhelmFinally].some((v) => v.trim())
      );
    }
    case "digital": {
      const p = parseDigitalPayload(raw);
      return Object.values(p).some((v) => typeof v === "string" && v.trim());
    }
    case "emergency": {
      const p = parseEmergencyPayload(raw);
      return hasTableRows(p.contacts) || Object.values(p.medical).some((v) => v.trim());
    }
    case "family": {
      const p = parseFamilyPayload(raw);
      return p.notes.trim().length > 0 || hasTableRows(p.household) || hasTableRows(p.pets);
    }
    case "values": {
      const p = parseValuesPayload(raw);
      return (
        p.coreValues.some((v) => v.trim()) ||
        p.impactNotes.trim().length > 0 ||
        p.ratings.some((r) => r.value > 0) ||
        p.checklist.some((c) => c.on)
      );
    }
    case "story": {
      const p = parseStoryPayload(raw);
      return (
        p.letterBody.trim().length > 0 ||
        p.prompts.some((pr) => pr.body.trim()) ||
        hasTableRows(p.people)
      );
    }
    default: {
      const notes = raw.notes;
      return typeof notes === "string" && notes.trim().length > 0;
    }
  }
}
