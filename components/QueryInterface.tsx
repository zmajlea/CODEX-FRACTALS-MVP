import React from "react";

type QueryInterfaceProps = {
  value: string;
  onChange: (query: string) => void;
  resultCount?: number;
};

export default function QueryInterface({
  value,
  onChange,
  resultCount,
}: QueryInterfaceProps) {
  return (
    <div className="fixed bottom-12 left-16 right-0 z-40 flex flex-col items-center justify-center pointer-events-none gap-2">
      <div className="font-data text-[10px] tracking-widest text-obsidian/40 uppercase">
        Filter sealed records. Seal what&apos;s true.
      </div>
      <form
        onSubmit={(e) => e.preventDefault()}
        className="pointer-events-auto bg-vellum border border-bone py-4 px-8 shadow-[0_10px_40px_rgba(0,0,0,0.05)] flex items-center gap-6 w-full max-w-2xl"
      >
        <div className="w-2 h-2 rounded-full bg-obsidian/30" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Filter sealed obligations, dates, event types..."
          className="bg-transparent border-none outline-none w-full font-data text-xs tracking-wider text-obsidian placeholder:text-obsidian/40 placeholder:uppercase"
        />
        {value.trim() && resultCount !== undefined && (
          <div className="text-[10px] font-data text-obsidian/50 uppercase tracking-widest shrink-0">
            {resultCount} match{resultCount === 1 ? "" : "es"}
          </div>
        )}
      </form>
    </div>
  );
}
