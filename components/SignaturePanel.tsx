"use client";

type SignaturePanelProps = {
  isOpen: boolean;
  onClose: () => void;
  recordName?: string;
};

/** Journey 9 stretch — signature lifecycle UI shell */
export default function SignaturePanel({
  isOpen,
  onClose,
  recordName,
}: SignaturePanelProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-obsidian/30"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative bg-vellum border border-bone p-8 max-w-md w-full">
        <h2 className="font-head text-xl mb-2">Send for Signature</h2>
        <p className="font-data text-xs text-obsidian/50 mb-6">
          Signature ≠ Seal. Legal execution for {recordName ?? "this record"}.
        </p>
        <p className="font-data text-sm text-obsidian/60">
          Stretch goal shell — wire email delivery + status in production pass.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-6 font-data text-[10px] uppercase border border-bone px-4 py-2"
        >
          Close
        </button>
      </div>
    </div>
  );
}
