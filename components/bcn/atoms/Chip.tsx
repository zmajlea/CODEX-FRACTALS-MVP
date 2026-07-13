type Status = "empty" | "saved" | "sealed" | "start";

const statusClass: Record<Status, string> = {
  empty: "chip empty",
  saved: "chip saved",
  sealed: "chip sealed",
  start: "chip",
};

const statusLabel: Record<Status, string> = {
  empty: "Start",
  saved: "Saved",
  sealed: "Sealed",
  start: "Start",
};

type Props = {
  status: Status;
  label?: string;
};

export function Chip({ status, label }: Props) {
  const text = label ?? statusLabel[status];
  return (
    <span className={statusClass[status]}>
      <span className="dot" aria-hidden />
      {text}
    </span>
  );
}
