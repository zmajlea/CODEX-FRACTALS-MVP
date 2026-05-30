"use client";
import React, { useState } from 'react';

type CodexRailsProps = {
  activeRecord: { name: string; id: string } | null;
  onSwitchRecord: () => void;
  onOpenSecurity: () => void;
};

export default function CodexRails({ activeRecord, onSwitchRecord, onOpenSecurity }: CodexRailsProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  
  const isExpanded = isHovered || isPinned;
  return (
    <>
      {/* HEADER SECTION */}
      <header className="fixed top-0 left-0 right-0 h-16 border-b border-bone flex justify-between items-center px-8 z-50 bg-vellum/90 backdrop-blur-sm">
        <div className="flex items-center gap-6">
          <div className="font-head text-2xl font-bold tracking-widest uppercase">Fractals</div>
          {activeRecord && (
            <div className="bg-bone text-obsidian px-4 py-1 text-xs font-bold uppercase tracking-wider shadow-inner rounded-premium flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-cinnabar animate-pulse shadow-[0_0_8px_rgba(230,126,80,0.8)]"></span>
              {activeRecord.name} | ID: {activeRecord.id}
            </div>
          )}
        </div>
        <div className="flex items-center gap-6">
          <button 
            onClick={onOpenSecurity}
            className="text-[11px] font-data text-obsidian/85 hover:text-obsidian tracking-widest font-semibold bg-bone/20 px-4 py-1.5 border border-bone hover:bg-bone/40 transition-all flex items-center gap-2 uppercase"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-[#E67E50]"></div>
            {activeRecord ? activeRecord.name : 'Record'}
          </button>
          <button className="text-sm font-data uppercase tracking-widest hover:opacity-70 transition-opacity">Settings</button>
        </div>
      </header>

      {/* SIDEBAR NAVIGATION */}
      <aside 
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={"fixed left-0 top-16 bottom-0 border-r border-bone bg-vellum flex flex-col py-6 gap-8 z-40 transition-all duration-300 ease-in-out " + (isExpanded ? "w-64 px-6 items-start" : "w-16 items-center")}
      >
        <button onClick={onSwitchRecord} className="flex items-center gap-4 hover:opacity-70 transition-opacity w-full overflow-hidden" title="Records">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-oxford min-w-[20px]"><path d="M4 6h16M4 12h16M4 18h7"/></svg>
          <span className={"font-data text-xs uppercase tracking-widest whitespace-nowrap transition-opacity duration-300 " + (isExpanded ? "opacity-100" : "opacity-0")}>Records</span>
        </button>
        
        <div className={"h-px bg-bone my-2 transition-all duration-300 " + (isExpanded ? "w-full" : "w-8")}></div>

        <button className="flex items-center gap-4 hover:opacity-70 transition-opacity w-full overflow-hidden" title="Platform Modules">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-oxford min-w-[20px]"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          <span className={"font-data text-xs uppercase tracking-widest whitespace-nowrap transition-opacity duration-300 " + (isExpanded ? "opacity-100" : "opacity-0")}>Platform Modules</span>
        </button>
        
        <button className="flex items-center gap-4 hover:opacity-70 transition-opacity w-full overflow-hidden" title="Audit Log">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-oxford min-w-[20px]"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span className={"font-data text-xs uppercase tracking-widest whitespace-nowrap transition-opacity duration-300 " + (isExpanded ? "opacity-100" : "opacity-0")}>Audit Log</span>
        </button>
        
        <button className="flex items-center gap-4 hover:opacity-70 transition-opacity w-full overflow-hidden" title="Ingestion Pipeline">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-oxford min-w-[20px]"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          <span className={"font-data text-xs uppercase tracking-widest whitespace-nowrap transition-opacity duration-300 " + (isExpanded ? "opacity-100" : "opacity-0")}>Ingestion Pipeline</span>
        </button>

        {/* PIN TOGGLE AT BOTTOM */}
        <div className="mt-auto w-full">
          <div className={"h-px bg-bone mb-6 transition-all duration-300 " + (isExpanded ? "w-full" : "w-8 mx-auto")}></div>
          <button 
            onClick={() => setIsPinned(!isPinned)} 
            className={"flex items-center gap-4 transition-opacity w-full overflow-hidden " + (isPinned ? "opacity-100 text-cinnabar" : "opacity-50 hover:opacity-100 text-oxford")}
            title="Toggle Sidebar Pin"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="min-w-[20px]">
              {isPinned 
                ? <path d="M2 12a10 10 0 0 1 10-10 M12 2v10l5 5"/> 
                : <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6 M12 2v13 M8 8l4-4 4 4"/>}
            </svg>
            <span className={"font-data text-[10px] pb-[-2px] tracking-widest uppercase whitespace-nowrap transition-opacity duration-300 " + (isExpanded ? "opacity-100" : "opacity-0")}>
              {isPinned ? "Unpin Sidebar" : "Pin Sidebar"}
            </span>
          </button>
        </div>
      </aside>
    </>
  );
}
