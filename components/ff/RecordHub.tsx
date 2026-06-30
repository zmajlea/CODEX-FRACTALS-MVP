"use client";

import { FF_SECTIONS } from "@/lib/ff/sections";
import { Chip } from "@/components/ff/atoms/Chip";

type SectionStatus = Record<string, "empty" | "saved" | "sealed">;

type Props = {
  vaultName: string;
  sectionStatus: SectionStatus;
  activeSectionId: string;
  onSelect: (id: string) => void;
  onNextStep: () => void;
};

export function RecordHub({
  vaultName,
  sectionStatus,
  activeSectionId,
  onSelect,
  onNextStep,
}: Props) {
  const sealed = Object.values(sectionStatus).filter((s) => s === "sealed").length;
  const saved = Object.values(sectionStatus).filter((s) => s === "saved").length;
  const empty = FF_SECTIONS.length - sealed - saved;

  const next = FF_SECTIONS.find((s) => sectionStatus[s.id] !== "sealed") ?? FF_SECTIONS[0]!;

  return (
    <div className="hubhead">
      <p className="mh-meta">
        <span className="big">{vaultName} Navigator</span>
        <span className="sub">The people you love should not have to become detectives.</span>
      </p>
      <p className="text-sm mb-4">
        {sealed} sealed · {saved} in progress · {empty} to start
      </p>
      <div className="nextstep border-l-4 pl-4 mb-6" style={{ borderColor: "var(--cinnabar)" }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase text-codex-muted">Your one next step</p>
            <p className="font-head">{next.title}</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={onNextStep}>
            Continue
          </button>
        </div>
      </div>
      <div className="cards3 grid gap-3 sm:grid-cols-2">
        {FF_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`scard text-left p-4 rounded-lg border border-bone bg-white${
              sectionStatus[s.id] === "sealed" ? " sealed" : ""
            }${activeSectionId === s.id ? " warm" : ""}`}
            onClick={() => onSelect(s.id)}
          >
            <p className="c-title font-head text-base mb-1">{s.short}</p>
            <p className="c-why text-xs italic text-codex-muted mb-2">{s.why}</p>
            <Chip
              status={sectionStatus[s.id] ?? "empty"}
              label={(sectionStatus[s.id] ?? "empty").toUpperCase()}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
