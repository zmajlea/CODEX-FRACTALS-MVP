/** Canonical FF continuity wizard sections (from FF_v1/shared/app.js). */
export type FfSectionDef = {
  id: string;
  title: string;
  short: string;
  why: string;
  subtitle: string;
};

export const FF_SECTIONS: FfSectionDef[] = [
  {
    id: "people",
    title: "Primary Family Contact & First Call Team",
    short: "First Call",
    why: "A clear starting point is one of the greatest gifts you can leave.",
    subtitle:
      "The people I would want contacted first — to coordinate, locate information, and steady decisions.",
  },
  {
    id: "advisors",
    title: "Trusted Advisor Directory",
    short: "Advisors",
    why: "In difficult times, trusted relationships matter more than information.",
    subtitle:
      "The professionals my family can call to explain financial, legal, insurance, and business matters.",
  },
  {
    id: "locator",
    title: "Critical Information & Documents Locator",
    short: "Locator",
    why: "Knowing where to look can be one of the kindest gifts you leave behind.",
    subtitle:
      "What exists, and where to find it — records, documents, and resources, in one place.",
  },
  {
    id: "business",
    title: "Understanding My Business Situation",
    short: "Business",
    why: "Context helps the people you love make sense of what you built.",
    subtitle: "How the business works, who depends on it, and what matters day to day.",
  },
  {
    id: "transition",
    title: "Business Transition Options & Notes",
    short: "Transition",
    why: "Options reduce panic when decisions must be made quickly.",
    subtitle: "What I have considered for continuity, sale, or succession.",
  },
  {
    id: "financial",
    title: "Financial Resources & Protection",
    short: "Financial",
    why: "Clarity about resources prevents costly mistakes under stress.",
    subtitle: "Accounts, policies, and protections my family should know about.",
  },
  {
    id: "continuity",
    title: "Business Continuity Priorities",
    short: "Continuity",
    why: "Priorities guide action when there is no time to guess.",
    subtitle: "What must keep running, who can help, and in what order.",
  },
  {
    id: "digital",
    title: "Digital Access & Credentials",
    short: "Digital",
    why: "Modern life lives behind passwords — leave a map, not a maze.",
    subtitle: "Where digital assets live and how trusted people can access them.",
  },
  {
    id: "emergency",
    title: "Emergency Information & Critical Details",
    short: "Emergency",
    why: "Some facts cannot wait for a search.",
    subtitle: "Medical, safety, and time-sensitive details for first responders and family.",
  },
  {
    id: "family",
    title: "Family Information & Important Details",
    short: "Family",
    why: "The small details of daily life become enormous in a crisis.",
    subtitle: "Household, dependents, pets, and routines worth preserving.",
  },
  {
    id: "values",
    title: "My Values, My Wishes",
    short: "Values",
    why: "Values outlast documents.",
    subtitle: "What I hope my family remembers and honors.",
  },
  {
    id: "story",
    title: "Story, Letter & Memories",
    short: "Letter",
    why: "A letter can steady someone when nothing else can.",
    subtitle: "Words I want left behind — story, gratitude, and guidance.",
  },
];

export type FfSectionPayload = Record<string, unknown>;

export type FfWizardState = {
  sections: Record<string, FfSectionPayload>;
};

export function emptyWizardState(): FfWizardState {
  return { sections: Object.fromEntries(FF_SECTIONS.map((s) => [s.id, {}])) };
}
