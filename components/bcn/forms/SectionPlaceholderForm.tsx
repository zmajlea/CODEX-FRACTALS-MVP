"use client";

import { TextAreaField } from "@/components/bcn/atoms/Field";
import { Panel } from "@/components/bcn/forms/Panel";

type Props = {
  notes: string;
  onChange: (notes: string) => void;
  onBlur: () => void;
  disabled?: boolean;
};

/** Stub body for sections not yet built out in Phase C. */
export function SectionPlaceholderForm({ notes, onChange, onBlur, disabled }: Props) {
  return (
    <Panel>
      <TextAreaField
        label="Section notes"
        rows={4}
        placeholder="Capture what matters for this section…"
        value={notes}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </Panel>
  );
}
