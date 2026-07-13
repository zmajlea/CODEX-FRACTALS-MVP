import type { ReactNode } from "react";
import { BcnIcon } from "@/components/bcn/BcnIcon";
import type { BcnIconName } from "@/lib/bcn/icons";

type Props = {
  title?: string;
  icon?: BcnIconName;
  children: ReactNode;
  className?: string;
  id?: string;
};

export function Panel({ title, icon, children, className, id }: Props) {
  return (
    <div id={id} className={`panel${className ? ` ${className}` : ""}`}>
      {title ? (
        <div className="panel-h">
          {icon ? (
            <span className="ph-ic">
              <BcnIcon name={icon} />
            </span>
          ) : null}
          <span className="ph-t">{title}</span>
        </div>
      ) : null}
      {children}
    </div>
  );
}

type GridProps = {
  one?: boolean;
  children: ReactNode;
};

export function FGrid({ one, children }: GridProps) {
  return <div className={`fgrid${one ? " one" : ""}`}>{children}</div>;
}
