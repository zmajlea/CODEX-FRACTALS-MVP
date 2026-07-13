"use client";

import type { ReactNode } from "react";
import { BcnIcon } from "@/components/bcn/BcnIcon";
import { BcnNib } from "@/components/bcn/brand/BcnBrandMarks";
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
  pinned?: boolean;
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
  const className = [
    "ritem",
    item.active ? "on" : "",
    item.pinned ? "pinned" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <BcnIcon name={item.icon} />
      <span className="ri-t">{item.label}</span>
      {item.unreadDot ? <span className="ri-dot" /> : null}
      {item.sealed ? <BcnNib dataBrand={dataBrand} /> : null}
    </>
  );

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

function FractalsMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5 21.5 12 12 21.5 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M12 8 16 12 12 16 8 12Z" fill="currentColor" />
    </svg>
  );
}

function BcnSolutionMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5 20 5.2v6.2c0 5-3.4 8.5-8 10.1-4.6-1.6-8-5.1-8-10.1V5.2L12 2.5Z" />
    </svg>
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
        <div className="railbrand">
          {showBcnSolutionLine ? (
            <div className="rb-line rb-ff" title="A Business Continuity Navigator solution">
              <span className="rb-mark">
                <BcnSolutionMark />
              </span>
              <span className="ri-t rb-t">A Business Continuity Navigator solution</span>
            </div>
          ) : null}
          {showPoweredBy ? (
            <div className="rb-line rb-fr" title="Powered by Fractals">
              <span className="rb-mark">
                <FractalsMark />
              </span>
              <span className="ri-t rb-t">
                powered by <b>Fractals</b>
              </span>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}

export type { ReactNode };
