"use client";

import { BcnIcon } from "@/components/bcn/BcnIcon";
import { SectionCard } from "@/components/bcn/SectionCard";
import { BCN_HUB_GROUPS } from "@/lib/bcn/hub-groups";
import { BCN_SECTIONS } from "@/lib/bcn/sections";
import { SECTION_ICON_BY_ID } from "@/lib/bcn/icons";

type SectionStatus = Record<string, "empty" | "saved" | "sealed">;

type Props = {
  vaultName: string;
  sectionStatus: SectionStatus;
  onSelect: (id: string) => void;
  onNextStep: () => void;
  onInviteTrusted?: () => void;
  onExport?: () => void;
};

function countStatus(sectionStatus: SectionStatus, status: "sealed" | "saved") {
  return BCN_SECTIONS.filter((s) => sectionStatus[s.id] === status).length;
}

export function RecordHub({
  vaultName,
  sectionStatus,
  onSelect,
  onNextStep,
  onInviteTrusted,
  onExport,
}: Props) {
  const sealed = countStatus(sectionStatus, "sealed");
  const saved = countStatus(sectionStatus, "saved");
  const empty = BCN_SECTIONS.length - sealed - saved;
  const next =
    BCN_SECTIONS.find((s) => sectionStatus[s.id] === "saved") ??
    BCN_SECTIONS.find((s) => sectionStatus[s.id] !== "sealed") ??
    BCN_SECTIONS[0]!;
  const nextStatus = sectionStatus[next.id] ?? "empty";
  const nextIcon = SECTION_ICON_BY_ID[next.id] ?? "doc";

  return (
    <section className="view on" aria-label="Record home">
      <div className="hubhead">
        <div>
          <div className="eyebrow">Owner Record</div>
          <h1 className="title">{vaultName}&apos;s Navigator</h1>
          <p className="subtag">
            &ldquo;The people you love should not have to become detectives.&rdquo;
          </p>
        </div>
        <div className="mh-meta">
          <div className="big">{sealed}</div>
          <div className="sub">of {BCN_SECTIONS.length} sealed</div>
        </div>
      </div>

      <div className="hub-progress" aria-hidden="true">
        <span className="hp-bar">
          <span
            className="hp-fill"
            style={{ width: `${Math.round((sealed / BCN_SECTIONS.length) * 100)}%` }}
          />
        </span>
        <span className="hp-note">
          {sealed} sealed · {saved} in progress · {empty} to start
        </span>
      </div>

      <div className="nextstep">
        <span className="ns-ic">
          <BcnIcon name={nextIcon} />
        </span>
        <div>
          <div className="ns-k">Your one next step</div>
          <div className="ns-t">{next.title}</div>
        </div>
        <span className="grow" />
        <button type="button" className="btn" onClick={onNextStep}>
          {nextStatus === "empty" ? "Begin" : "Continue"} ›
        </button>
      </div>

      <div className="cards3 grouped">
        {BCN_HUB_GROUPS.flatMap((group) => {
          const groupSealed = group.ids.filter(
            (id) => sectionStatus[id] === "sealed"
          ).length;
          return [
            <div className="cg-head" key={`${group.label}-head`}>
              <span className="cg-label">{group.label}</span>
              <span className="cg-count">
                {groupSealed}/{group.ids.length} sealed
              </span>
            </div>,
            ...group.ids.map((id) => {
              const section = BCN_SECTIONS.find((s) => s.id === id);
              if (!section) return null;
              return (
                <SectionCard
                  key={id}
                  section={section}
                  status={sectionStatus[id] ?? "empty"}
                  onOpen={() => onSelect(id)}
                />
              );
            }),
          ];
        })}
      </div>

      <div className="hub-actions">
        <button type="button" className="hubact" onClick={onExport}>
          <span className="ha-ic">
            <BcnIcon name="download" />
          </span>
          <div>
            <b>Export the sealed record</b>
            <small>Store it safely · give it to one trusted person</small>
          </div>
        </button>
        <button type="button" className="hubact" onClick={onInviteTrusted}>
          <span className="ha-ic">
            <BcnIcon name="share" />
          </span>
          <div>
            <b>Choose who can find it</b>
            <small>Make sure the right person can reach it</small>
          </div>
        </button>
        <button type="button" className="hubact">
          <span className="ha-ic">
            <BcnIcon name="calendar" />
          </span>
          <div>
            <b>Annual review</b>
            <small>Keep it true as life changes</small>
          </div>
        </button>
      </div>
    </section>
  );
}
