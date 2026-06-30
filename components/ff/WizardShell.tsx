"use client";

import type { ReactNode } from "react";
import { SealFx } from "@/components/ff/SealFx";

type Props = {
  children: ReactNode;
  rail: ReactNode;
  sealVisible?: boolean;
  sectionSealed?: boolean;
};

export function WizardShell({ children, rail, sealVisible, sectionSealed }: Props) {
  return (
    <div className={`app cs${sectionSealed ? " sec-sealed" : ""}`} id="app">
      <SealFx visible={Boolean(sealVisible)} />
      <div className="app-row">
        <aside className="rail app-rail" id="rail">
          {rail}
        </aside>
        <div className="app-main">
          <div className="app-wrap">
            <div id="viewhost">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
