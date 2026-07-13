"use client";

import { BCN_SECTIONS } from "@/lib/bcn/sections";
import type { BcnSectionPayload } from "@/lib/bcn/sections";
import { useBcnThemeOptional } from "@/components/bcn/BcnThemeContext";
import { defaultWordmark } from "@/components/bcn/brand/BcnBrandMarks";

type SectionStatus = Record<string, "empty" | "saved" | "sealed">;

type Props = {
  vaultName: string;
  recordId: string;
  sectionStatus: SectionStatus;
  sections: Record<string, BcnSectionPayload>;
  onClose: () => void;
  onPrint: () => void;
};

function sealedCount(sectionStatus: SectionStatus): number {
  return BCN_SECTIONS.filter((s) => sectionStatus[s.id] === "sealed").length;
}

export function RecordExportView({
  vaultName,
  recordId,
  sectionStatus,
  sections,
  onClose,
  onPrint,
}: Props) {
  const theme = useBcnThemeOptional();
  const wordmark = theme.wordmark ?? defaultWordmark(theme.dataBrand);
  const sealed = sealedCount(sectionStatus);
  const saved = BCN_SECTIONS.filter((s) => sectionStatus[s.id] === "saved").length;
  const empty = BCN_SECTIONS.length - sealed - saved;

  return (
    <div className="sealfx on" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div
        className="modal-sheet"
        data-brand={theme.dataBrand}
        style={{ width: "min(720px, 96vw)", maxHeight: "92vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <section className="view on record-export-dialog" aria-label="Export record">
          <div className="crumb">
            <button type="button" className="btn ghost sm" onClick={onClose}>
              ‹ Back
            </button>
          </div>
          <div className="sec-head">
            <h2 className="sec-title" id="export-title">
              Export the sealed record
            </h2>
          </div>
          <p className="panel-note">
            Generated in your browser from your record data. Encrypted at rest. Only you
            and the people you authorize can see your information.
          </p>

          <div className="export-doc" id="record-export-print-root">
            <div className="exd-head">
              <div>
                <div className="exd-wm">{wordmark}</div>
                <div className="exd-title">{vaultName}&apos;s Navigator</div>
                <div className="exd-meta">
                  Business Continuity Navigator · {recordId} · {sealed} of{" "}
                  {BCN_SECTIONS.length} sections sealed
                </div>
              </div>
            </div>
            <div className="exd-list">
              {BCN_SECTIONS.map((s) => {
                const st = sectionStatus[s.id] ?? "empty";
                return (
                  <div key={s.id} className={`ex-row ${st}`}>
                    <span className="ex-name">{s.title}</span>
                    <span className="ex-state">
                      {st === "sealed"
                        ? "Sealed · final"
                        : st === "saved"
                          ? "Saved · not yet sealed"
                          : "Not yet captured"}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="exd-summary">
              <b>Completeness:</b> {sealed} sealed, {saved} in progress, {empty} not yet started.
              Unsealed sections are listed but not treated as verified.
            </div>
            <div className="export-print-body">
              {BCN_SECTIONS.map((s) => {
                const payload = sections[s.id];
                const notes =
                  typeof payload?.notes === "string" ? payload.notes.trim() : "";
                if (!notes && sectionStatus[s.id] === "empty") return null;
                return (
                  <div key={`body-${s.id}`} className="export-section-block">
                    <h3>{s.short}</h3>
                    {notes ? <p>{notes}</p> : (
                      <p className="panel-note">Open this section before export for full detail.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="export-cta">
            <button type="button" className="btn lg" onClick={onPrint}>
              Download / print PDF
            </button>
          </div>
          <p className="export-foot">
            Store in a fire-resistant safe or secure vault. Tell one trusted person it exists.
          </p>
        </section>
      </div>
    </div>
  );
}
