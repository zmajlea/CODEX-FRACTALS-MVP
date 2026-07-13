import { Chip } from "@/components/bcn/atoms/Chip";

type Status = "empty" | "saved" | "sealed";

type Props = {
  title: string;
  status: Status;
};

export function SectionHead({ title, status }: Props) {
  return (
    <div className="sec-head">
      <h2 className="sec-title">{title}</h2>
      <Chip status={status} />
    </div>
  );
}
