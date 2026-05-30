import React, { useState } from 'react';

export type RecordEntity = {
  id: string;
  name: string;
};

type SwitchboardProps = {
  records: RecordEntity[];
  onSelectRecord: (record: RecordEntity) => void;
};

export default function Switchboard({ records, onSelectRecord }: SwitchboardProps) {
  const [isHandshaking, setIsHandshaking] = useState(false);

  const handleSelect = (record: RecordEntity) => {
    setIsHandshaking(true);
    // Security pulse/fade-to-black effect handshake
    setTimeout(() => {
      onSelectRecord(record);
    }, 1000); // 1s transition matching the 'Handshake' expectation
  };

  return (
    <div className={"fixed inset-0 flex items-center justify-center bg-vellum z-30 transition-colors duration-1000 ease-in-out " + (isHandshaking ? "!bg-obsidian" : "")}>
      <style dangerouslySetInnerHTML={{ __html: 
        ".etched-card { " +
        "  background-color: var(--vellum); " +
        "  border: 1px solid var(--bone); " +
        "  box-shadow: inset 1px 1px 2px rgba(0,0,0,0.05), inset -1px -1px 2px rgba(255,255,255,0.5); " +
        "  transition: all 0.3s ease; " +
        "} " +
        ".etched-card:hover { " +
        "  box-shadow: inset 2px 2px 5px rgba(0,0,0,0.1), inset -2px -2px 5px rgba(255,255,255,0.8); " +
        "  transform: translateY(-2px); " +
        "}"
      }} />
      
      <div className={"flex flex-col items-center gap-16 transition-opacity duration-500 delay-100 " + (isHandshaking ? "opacity-0" : "opacity-100")}>
        <div className="text-center space-y-4 font-head">
          <h1 className="text-4xl text-obsidian tracking-wide">Select a Record</h1>
          <p className="text-obsidian/60 tracking-wider">Open a record to begin.</p>
        </div>
        <div className="flex gap-10">
          {records.map((rec) => (
            <button 
            key={rec.id}
            onClick={() => handleSelect(rec)}
            className="etched-card w-80 h-96 flex flex-col items-center justify-center rounded-premium cursor-pointer outline-none relative group"
          >
            {/* Minimal line embellishment mimicking ledger vellum volumes */}
            <div className="absolute top-8 left-8 right-8 border-t border-bone/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div className="absolute bottom-8 left-8 right-8 border-b border-bone/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

              <h2 className="font-head text-3xl mb-4 text-obsidian tracking-wide">{rec.name}</h2>
              <span className="font-data text-xs uppercase tracking-ultra text-oxford bg-bone/20 px-4 py-2 mt-4 transition-colors group-hover:bg-bone/40">Open Record</span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-col items-center">
          <div className="h-px w-24 bg-bone/40 mb-6"></div>
          <a 
            href="/mockups/journey3/option1"
            className="group flex items-center gap-3 font-data text-[10px] uppercase tracking-ultra text-obsidian/60 hover:text-obsidian bg-bone/10 border border-bone/30 hover:border-bone/60 px-6 py-2.5 transition-all shadow-[0_1px_5px_rgba(0,0,0,0.01)] hover:shadow-md"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-cinnabar/80 group-hover:scale-125 transition-transform"></span>
            Sovereign Multi-View Gateway (3 Options Mockup)
          </a>
        </div>
      </div>
    </div>
  );
}
