import { BCN_ICONS, type BcnIconName } from "@/lib/bcn/icons";

type Props = {
  name: BcnIconName;
};

export function BcnIcon({ name }: Props) {
  const paths = BCN_ICONS[name] ?? BCN_ICONS.doc;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: paths }}
    />
  );
}
