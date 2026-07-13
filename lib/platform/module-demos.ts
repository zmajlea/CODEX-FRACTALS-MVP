export type ModuleDemo = {
  slug: string;
  name: string;
  tagline: string;
  highlights: string[];
  routeBase: string;
  status?: string;
};

export const MODULE_DEMOS: Record<string, ModuleDemo> = {
  ff: {
    slug: "bcn",
    name: "Business Continuity Navigator",
    tagline: "Manual business-continuity wizard for owners and families.",
    highlights: [
      "Twelve sealed continuity sections",
      "Encrypted at rest with authorized access only",
      "Trusted advisor emergency protocol",
    ],
    routeBase: "/ff",
  },
  bcn: {
    slug: "bcn",
    name: "Business Continuity Navigator",
    tagline: "Manual business-continuity wizard for owners and families.",
    highlights: [
      "Twelve sealed continuity sections",
      "Encrypted at rest with authorized access only",
      "Trusted advisor emergency protocol",
    ],
    routeBase: "/bcn",
  },
  deadlines: {
    slug: "deadlines",
    name: "Deadlines",
    tagline: "Track filing and compliance dates in one calm timeline.",
    highlights: [
      "Shared deadline calendar",
      "CPA-visible metadata only",
      "Beta module",
    ],
    routeBase: "/deadlines",
    status: "beta",
  },
  treasury: {
    slug: "treasury",
    name: "Treasury",
    tagline: "Read bank balances and transactions via Plaid.",
    highlights: [
      "Link bank accounts securely",
      "View balances by institution",
      "Recent transaction history",
    ],
    routeBase: "/treasury",
    status: "beta",
  },
};

export function demoForModule(slug: string, name?: string): ModuleDemo {
  return (
    MODULE_DEMOS[slug] ?? {
      slug,
      name: name ?? slug,
      tagline: "Fractals module",
      highlights: ["Provisioned by your advisor"],
      routeBase: `/${slug}`,
    }
  );
}
