import type { BcnRailGroup } from "@/components/bcn/BcnRail";

export function treasuryPortfolioRailGroups(opts: {
  inboxUnread: number;
  active: "portfolio" | "inbox";
}): BcnRailGroup[] {
  return [
    {
      label: "Portfolio",
      items: [
        {
          id: "treasury-portfolio",
          icon: "grid",
          label: "Portfolio Dashboard",
          active: opts.active === "portfolio",
          href: "/operator/treasury",
        },
        {
          id: "treasury-inbox",
          icon: "inbox",
          label: "Inbox",
          badge: opts.inboxUnread,
          active: opts.active === "inbox",
          href: "/operator/treasury/inbox",
        },
        {
          id: "treasury-settings",
          icon: "gear",
          label: "Settings",
          stub: true,
        },
      ],
    },
  ];
}
