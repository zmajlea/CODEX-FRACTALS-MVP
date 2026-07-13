import { BcnIcon } from "@/components/bcn/BcnIcon";
import { sealMark } from "@/components/bcn/brand/BcnBrandMarks";
import { useBcnThemeOptional } from "@/components/bcn/BcnThemeContext";

type Props = {
  sectionId: string;
  signer: string;
  sealing?: boolean;
  sealed?: boolean;
  onSeal: () => void;
};

export function SealBar({
  sectionId,
  signer,
  sealing = false,
  sealed = false,
  onSeal,
}: Props) {
  const theme = useBcnThemeOptional();

  return (
    <>
      <div className="sealbar">
        <span className="saveind">
          <svg
            className="tick"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12.5l4.5 4.5L19 7" />
          </svg>
          <span data-saveind>Saved automatically</span>
        </span>
        <span className="grow" />
        <span className="note">
          Sealing marks this section verified — only sealed sections are treated as final.
        </span>
        {!sealed ? (
          <button
            className="btn-seal"
            type="button"
            data-seal={sectionId}
            disabled={sealing}
            onClick={onSeal}
          >
            <svg
              className="ic"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M12 3.5 19 6v6c0 4.4-3 7.4-7 8.7C8 19.4 5 16.4 5 12V6l7-2.5Z" />
            </svg>
            {sealing ? "Sealing…" : "Seal this section"}
          </button>
        ) : null}
      </div>
      <div className="sec-sealed-note">
        <span className="ssn-mark">{sealMark(theme.dataBrand)}</span>
        Sealed by {signer} · this section is now verified and final. Re-open it any time to
        update.
      </div>
    </>
  );
}
