"use client";

import {
  EVENT_TYPES,
  composeLabel,
  validateComposedLabel,
} from "@/lib/temporal/event-types";

type PulseLabelFieldsProps = {
  eventType: string;
  qualifier: string;
  onEventTypeChange: (value: string) => void;
  onQualifierChange: (value: string) => void;
  readOnly?: boolean;
  showErrors?: boolean;
};

export default function PulseLabelFields({
  eventType,
  qualifier,
  onEventTypeChange,
  onQualifierChange,
  readOnly = false,
  showErrors = true,
}: PulseLabelFieldsProps) {
  const composed = composeLabel(eventType || "…", qualifier || "…");
  const validationError = showErrors
    ? validateComposedLabel(eventType, qualifier)
    : null;

  if (readOnly) {
    return (
      <div className="space-y-2">
        <label className="font-data text-xs text-oxford uppercase tracking-widest font-bold">
          Label
        </label>
        <div className="font-data text-sm mt-2 border-b border-dashed border-bone pb-1">
          {eventType && qualifier
            ? composeLabel(eventType, qualifier)
            : "—"}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="font-data text-[10px] uppercase tracking-ultra text-oxford">
          Event Type
        </label>
        <select
          value={eventType}
          onChange={(e) => onEventTypeChange(e.target.value)}
          className="mt-1 w-full border border-bone bg-vellum px-3 py-2 font-data text-sm outline-none focus:border-oxford"
        >
          <option value="">Select event type…</option>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="font-data text-[10px] uppercase tracking-ultra text-oxford">
          Qualifier
        </label>
        <input
          value={qualifier}
          onChange={(e) => onQualifierChange(e.target.value)}
          className="mt-1 w-full border-b border-bone bg-transparent py-2 font-head text-lg outline-none focus:border-oxford"
          placeholder="Short clause fragment"
        />
      </div>
      <div className="border border-bone/40 bg-bone/5 px-3 py-2">
        <p className="font-data text-[9px] uppercase tracking-ultra text-obsidian/40 mb-1">
          Composed label
        </p>
        <p className="font-head text-sm text-obsidian">{composed}</p>
        {validationError && (
          <p className="font-data text-xs text-cinnabar mt-2">{validationError}</p>
        )}
      </div>
    </div>
  );
}

export function isPulseLabelValid(eventType: string, qualifier: string): boolean {
  return validateComposedLabel(eventType, qualifier) === null;
}
