"use client";

import type { ReactNode } from "react";
import { BcnIcon } from "@/components/bcn/BcnIcon";
import { BcnNib } from "@/components/bcn/brand/BcnBrandMarks";
import { RailBrandFoot } from "@/components/bcn/RailBrandFoot";
import type { BcnIconName } from "@/lib/bcn/icons";

export type BcnRailItem = {
  id: string;
  icon: BcnIconName;
  label: string;
  active?: boolean;
  href?: string;
  onClick?: () => void;
  sealed?: boolean;
  unreadDot?: boolean;
  badge?: number;
  pinned?: boolean;
  /** Summit R1 — disabled placeholder (e.g. Settings coming soon). */
  stub?: boolean;
};

export type BcnRailGroup = {
  label: string;
  reveal?: string;
  items: BcnRailItem[];
};

type Props = {
  groups: BcnRailGroup[];
  footItems?: BcnRailItem[];
  headContent?: ReactNode;
  showPoweredBy?: boolean;
  showBcnSolutionLine?: boolean;
  pinned?: boolean;
  dataBrand?: string;
  onTogglePin?: () => void;
  onLogout?: () => void;
};

function RailItem({ item, dataBrand }: { item: BcnRailItem; dataBrand?: string }) {
  const summit = dataBrand === "summit";
  const className = [
    "ritem",
    item.active ? "on" : "",
    item.pinned ? "pinned" : "",
    item.stub ? "stub" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const badgeClass = summit ? "rbadge" : "ri-badge";

  const content = (
    <>
      <BcnIcon name={item.icon} />
      <span className="ri-t">{item.label}</span>
      {item.badge != null && item.badge > 0 ? (
        <span className={badgeClass}>{item.badge}</span>
      ) : null}
      {item.unreadDot ? <span className="ri-dot" /> : null}
      {item.sealed ? <BcnNib dataBrand={dataBrand} /> : null}
    </>
  );

  if (item.stub) {
    return (
      <span className={className} aria-disabled="true" title="Settings">
        {content}
      </span>
    );
  }

  if (item.href) {
    return (
      <a className={className} href={item.href} onClick={item.onClick}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" className={className} onClick={item.onClick}>
      {content}
    </button>
  );
}

export function BcnRail({
  groups,
  footItems = [],
  headContent,
  showPoweredBy = true,
  showBcnSolutionLine = false,
  pinned = false,
  dataBrand,
  onTogglePin,
  onLogout,
}: Props) {
  const sysFoot: BcnRailItem[] = [
    ...(onTogglePin
      ? [
          {
            id: "pin",
            icon: "pin" as const,
            label: pinned ? "Unpin panel" : "Pin panel",
            pinned,
            onClick: onTogglePin,
          },
        ]
      : []),
    ...(onLogout
      ? [
          {
            id: "logout",
            icon: "out" as const,
            label: "Log out",
            onClick: onLogout,
          },
        ]
      : []),
  ];

  return (
    <>
      <nav className="rgroup">
        {headContent}
        {groups.map((group) => (
          <div key={group.label}>
            <div className="rlabel">
              <span>{group.label}</span>
              {group.reveal ? <span className="reveal">{group.reveal}</span> : null}
            </div>
            {group.items.map((item) => (
              <RailItem key={item.id} item={item} dataBrand={dataBrand} />
            ))}
          </div>
        ))}
      </nav>

      <div className="rfoot">
        {footItems.map((item) => (
          <RailItem key={item.id} item={item} dataBrand={dataBrand} />
        ))}
        {sysFoot.length > 0 ? (
          <div className="rfoot-sys">
            {sysFoot.map((item) => (
              <RailItem key={item.id} item={item} dataBrand={dataBrand} />
            ))}
          </div>
        ) : null}
      </div>

      {(showBcnSolutionLine || showPoweredBy) && (
        <RailBrandFoot
          showBcnSolutionLine={showBcnSolutionLine}
          showPoweredBy={showPoweredBy}
        />
      )}
    </>
  );
}

export type { ReactNode };
