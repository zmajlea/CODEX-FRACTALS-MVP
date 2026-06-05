"use client";

export type FullScanRow = {
  id: string;
  fileName: string;
  category: string;
  title: string;
  status: "pending" | "sealed" | "dismissed" | "deferred";
};

type FullScanQueueProps = {
  rows: FullScanRow[];
  onOpen: (id: string) => void;
};

export default function FullScanQueue({ rows, onOpen }: FullScanQueueProps) {
  const pending = rows.filter((r) => r.status === "pending");
  if (pending.length === 0) return null;

  return (
    <section className="border border-bone bg-vellum/90 mt-4">
      <h3 className="font-data text-[10px] uppercase tracking-ultra text-obsidian/50 px-4 py-3 border-b border-bone">
        Full Scan Review Queue
      </h3>
      {pending.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onOpen(r.id)}
          className="w-full grid grid-cols-[1fr_80px_1fr] gap-2 px-4 py-3 border-b border-bone/40 font-data text-xs text-left hover:bg-bone/10"
        >
          <span className="truncate">{r.fileName}</span>
          <span className="uppercase text-obsidian/50">{r.category}</span>
          <span className="truncate">{r.title}</span>
        </button>
      ))}
    </section>
  );
}
