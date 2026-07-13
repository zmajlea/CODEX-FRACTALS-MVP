import { BcnIcon } from "@/components/bcn/BcnIcon";
import type { BcnIconName } from "@/lib/bcn/icons";

type Props = {
  why: string;
  subtitle?: string;
  dataBrand?: string;
};

function calloutIcon(dataBrand?: string): BcnIconName {
  if (dataBrand === "summit") return "shield";
  if (dataBrand === "fractals") return "compass";
  return "heart";
}

function calloutAttr(dataBrand?: string): string {
  if (dataBrand === "summit") return "Summit Treasury";
  if (dataBrand === "fractals") return "Fractals";
  return "Business Continuity Navigator";
}

export function SectionWhy({ why, subtitle, dataBrand }: Props) {
  const icon = calloutIcon(dataBrand);
  const fractalsOrSummit = dataBrand === "summit" || dataBrand === "fractals";

  return (
    <>
      <figure className="bookcallout">
        <span className="bc-heart">
          <BcnIcon name={icon} />
        </span>
        <div className="bc-body">
          <blockquote className="bc-quote">{why}</blockquote>
          <figcaption className="bc-attr">
            <span className="bc-orn" aria-hidden="true">
              ◆
            </span>
            {calloutAttr(dataBrand)}
          </figcaption>
        </div>
      </figure>
      {subtitle ? <p className="sec-sub">{subtitle}</p> : null}
      {fractalsOrSummit ? null : null}
    </>
  );
}
