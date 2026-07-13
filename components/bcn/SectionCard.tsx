import { BcnIcon } from "@/components/bcn/BcnIcon";
import { Chip } from "@/components/bcn/atoms/Chip";
import { sealMark } from "@/components/bcn/brand/BcnBrandMarks";
import { useBcnThemeOptional } from "@/components/bcn/BcnThemeContext";
import type { BcnSectionDef } from "@/lib/bcn/sections";
import { SECTION_ICON_BY_ID } from "@/lib/bcn/icons";

type Status = "empty" | "saved" | "sealed";

type Props = {
  section: BcnSectionDef;
  status: Status;
  onOpen: () => void;
};

export function SectionCard({ section, status, onOpen }: Props) {
  const theme = useBcnThemeOptional();
  const icon = SECTION_ICON_BY_ID[section.id] ?? "doc";
  const whySnippet = section.subtitle.split("—")[0]?.trim() ?? section.subtitle;

  return (
    <button type="button" className={`scard${status === "sealed" ? " sealed" : ""}`} onClick={onOpen}>
      {status === "sealed" ? (
        <span className="sealwax">{sealMark(theme.dataBrand)}</span>
      ) : null}
      <span className="c-ic">
        <BcnIcon name={icon} />
      </span>
      <div className="c-title">{section.title}</div>
      <div className="c-why">{whySnippet}</div>
      <div className="c-foot">
        <Chip status={status} />
        <span className="c-open">Open ›</span>
      </div>
    </button>
  );
}
