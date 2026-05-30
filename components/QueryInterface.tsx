import React, { useState } from 'react';

type QueryInterfaceProps = {
  onSubmit: (query: string) => void;
  isProcessing: boolean;
};

export default function QueryInterface({ onSubmit, isProcessing }: QueryInterfaceProps) {
  const [query, setQuery] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() && !isProcessing) {
      onSubmit(query);
      setQuery('');
    }
  };

  return (
    <div className="fixed bottom-12 left-16 right-0 z-40 flex flex-col items-center justify-center pointer-events-none gap-2">
      <div className="font-data text-[10px] tracking-widest text-obsidian/40 uppercase">Identify pulses. Seal what&apos;s true.</div>
      <form 
        onSubmit={handleSubmit} 
        className={"pointer-events-auto bg-vellum border border-bone py-4 px-8 shadow-[0_10px_40px_rgba(0,0,0,0.05)] flex items-center gap-6 w-full max-w-2xl transition-all duration-300 " + (isProcessing ? "opacity-80 scale-95" : "opacity-100")}
      >
        <div className={"w-2 h-2 rounded-full " + (isProcessing ? "bg-cinnabar animate-pulse" : "bg-obsidian/30")}></div>
        <input 
          type="text" 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={isProcessing}
          placeholder={isProcessing ? "IDENTIFYING PULSES..." : "Search for obligations, dates, clauses..."}
          className="bg-transparent border-none outline-none w-full font-data text-xs tracking-wider text-obsidian placeholder:text-obsidian/40 placeholder:uppercase"
        />
        {isProcessing && (
          <div className="text-[10px] font-data text-cinnabar uppercase tracking-widest animate-pulse font-bold">IDENTIFYING PULSES...</div>
        )}
      </form>
    </div>
  );
}
