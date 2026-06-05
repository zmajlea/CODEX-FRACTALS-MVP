"use client";

export type DocProposal = {
  id: string;
  fileName: string;
  docType: string;
  parties: string;
  anchoringDate: string;
  status: "proposed" | "approved" | "dismissed";
};

type DocIdentifierQueueProps = {
  proposals: DocProposal[];
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  onEdit: (id: string) => void;
};

export default function DocIdentifierQueue({
  proposals,
  onApprove,
  onDismiss,
  onEdit,
}: DocIdentifierQueueProps) {
  const pending = proposals.filter((p) => p.status === "proposed");
  if (pending.length === 0) return null;

  return (
    <section className="border border-bone bg-vellum/90 mt-6">
      <h3 className="font-data text-[10px] uppercase tracking-ultra text-obsidian/50 px-4 py-3 border-b border-bone">
        Doc Identifier Queue
      </h3>
      {pending.map((p) => (
        <div
          key={p.id}
          className="grid grid-cols-[1fr_100px_100px_120px_auto] gap-2 px-4 py-3 border-b border-bone/40 font-data text-xs items-center"
        >
          <span className="truncate">{p.fileName}</span>
          <span className="text-obsidian/60">{p.docType}</span>
          <span className="text-obsidian/60 truncate">{p.parties}</span>
          <span>{p.anchoringDate}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onEdit(p.id)}
              className="text-[9px] uppercase tracking-widest border border-bone px-2 py-1"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onApprove(p.id)}
              className="text-[9px] uppercase tracking-widest bg-oxford text-vellum px-2 py-1"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => onDismiss(p.id)}
              className="text-[9px] uppercase tracking-widest text-obsidian/50 px-2 py-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
