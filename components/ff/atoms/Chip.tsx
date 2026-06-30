type Status = "empty" | "saved" | "sealed" | "start";

const statusClass: Record<Status, string> = {
  empty: "chip empty",
  saved: "chip saved",
  sealed: "chip sealed",
  start: "chip",
};

type Props = {
  status: Status;
  label: string;
};

export function Chip({ status, label }: Props) {
  return (
    <span className={statusClass[status]}>
      <span className="dot" aria-hidden />
      {label}
    </span>
  );
}
