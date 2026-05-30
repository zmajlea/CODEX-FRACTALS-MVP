import React, { useEffect, useRef, useState } from 'react';

type NautilusProps = {
  isInspectorOpen: boolean;
  activePulseId: string | null;
  onOpenInspector: (pulseId: string, coords: {x: number, y: number}) => void;
  sealedPulses: string[]; 
  pulses: Array<{id: string, r: number, theta: number, date?: string}>;
  showGrid?: boolean;
  invertScroll?: boolean;
};

// Year Parser
const getDecimalYear = (dateStr?: string) => {
  if (!dateStr) return 2024;
  const parts = dateStr.split('-');
  return parseInt(parts[0]) + (parseInt(parts[1] || '1') - 1) / 12;
};

const getCartesian = (cx: number, cy: number, r: number, theta: number) => {
  const rad = (theta - 90) * Math.PI / 180.0;
  return {
    x: cx + (r * Math.cos(rad)),
    y: cy + (r * Math.sin(rad))
  };
};

export default function NautilusGrid({ isInspectorOpen, activePulseId, onOpenInspector, sealedPulses, pulses, showGrid = false, invertScroll = false }: NautilusProps) {
  const [center, setCenter] = useState({ cx: 500, cy: 500 });
  
  // Calculate lowest bounding year
  const oldestYear = pulses.length > 0 ? Math.min(...pulses.map(p => getDecimalYear(p.date))) : 2022;
  
  // Z-Axis camera origin
  const [zCenterYear, setZCenterYear] = useState(oldestYear);
  const containerRef = useRef<HTMLDivElement>(null);

  // The visual tuning of how many px per year
  const DISTANCE_PER_YEAR = 120;
  // The absolute location of our visual "Frame" 
  const FRAME_RADIUS = DISTANCE_PER_YEAR * 2; // Roughly the 3rd ring out

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setCenter({
          cx: containerRef.current.clientWidth / 2,
          cy: containerRef.current.clientHeight / 2,
        });
      }
    };
    window.addEventListener('resize', updateSize);
    // Initial size calculation slightly delayed to ensure DOM is settled
    setTimeout(updateSize, 50);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const handleWheel = (e: React.WheelEvent) => {
    setZCenterYear(prev => {
      const delta = invertScroll ? e.deltaY * -0.002 : e.deltaY * 0.002;
      const nextZ = prev + delta;
      // We want the ring for the OLDEST year to stop when it frames the text nicely (e.g., at 50px radius)
      // 50px = (oldestYear - zMin) * 120 => zMin = oldestYear - (50 / 120)
      const limitZ = oldestYear - (50 / DISTANCE_PER_YEAR);
      return Math.max(nextZ, limitZ); 
    });
  };

  // Generate continuous rings starting from the integer bound of Z
  const visibleRingsCount = 8;
  const startIntYear = Math.max(Math.floor(zCenterYear), Math.floor(oldestYear));
  const rings = Array.from({ length: visibleRingsCount }).map((_, i) => startIntYear + i);

  // Read exactly the year that corresponds to the innermost visible ring
  // If zCenterYear = 2021.583, Math.ceil -> 2022. It frames exactly.
  const rootYearDisplay = Math.ceil(zCenterYear);

  return (
    <div 
      ref={containerRef} 
      onWheel={handleWheel}
      className={"fixed top-16 left-16 right-0 bottom-0 z-10 transition-all duration-700 ease-in-out " + (isInspectorOpen ? "blur-[6px] opacity-30 grayscale-[20%]" : "opacity-100 grayscale-0")}
      style={{ boxShadow: "inset 0 0 40px 10px rgba(255, 255, 255, 0.2)" }}
    >
      <svg className="w-full h-full cursor-grab active:cursor-grabbing">
        <defs>
          <filter id="deboss-stamp" x="-20%" y="-20%" width="140%" height="140%">
            <feOffset dx="1" dy="1"/>
            <feGaussianBlur stdDeviation="1" result="offset-blur"/>
            <feComposite operator="out" in="SourceGraphic" in2="offset-blur" result="inverse"/>
            <feFlood floodColor="rgba(26,26,27,0.15)" floodOpacity="1" result="color"/>
            <feComposite operator="in" in="color" in2="inverse" result="shadow"/>
            <feComposite operator="over" in="shadow" in2="SourceGraphic"/>
          </filter>
        </defs>
        {/* RINGS */}
        <g className="transition-all duration-[50ms]">
          {rings.map((yearStr, idx) => {
            if (yearStr < Math.floor(oldestYear)) return null; // Never draw before recorded history
            const r = (yearStr - zCenterYear) * DISTANCE_PER_YEAR;
            if (r <= 0) return null; // Behind camera
            
            // Frame Ring receives darker visual distinction
            const isFrameRing = Math.abs(r - FRAME_RADIUS) < (DISTANCE_PER_YEAR / 2);
            
            return (
              <circle 
                key={`ring-${yearStr}`} 
                cx={center.cx} cy={center.cy} 
                r={r} 
                fill="none" 
                stroke={isFrameRing ? "var(--obsidian)" : "var(--bone)"} 
                strokeWidth={isFrameRing ? "1" : "0.5"} 
                opacity={isFrameRing ? "0.4" : "0.7"} 
                className={isFrameRing ? "transition-colors duration-500" : ""}
              />
            );
          })}

          {/* DYNAMIC ORIGIN (CENTER) HUD */}
          <text 
            x={center.cx} 
            y={center.cy + 10} 
            textAnchor="middle" 
            className="font-head text-[32px] fill-obsidian tracking-wide opacity-60 font-bold pointer-events-none"
            style={{ transformOrigin: `${center.cx}px ${center.cy}px` }}
          >
            {rootYearDisplay}
          </text>
          <circle cx={center.cx} cy={center.cy} r="3" fill="var(--obsidian)" opacity="0.3"></circle>

          {/* Temporal Grid Lines */}
          {showGrid && Array.from({ length: 12 }).map((_, i) => {
            const angle = (i * 30);
            const startPos = getCartesian(center.cx, center.cy, 50, angle);
            const endPos = getCartesian(center.cx, center.cy, visibleRingsCount * DISTANCE_PER_YEAR, angle);
            
            return (
              <line 
                key={`axis-${i}`} 
                x1={startPos.x} y1={startPos.y} 
                x2={endPos.x} y2={endPos.y} 
                stroke="var(--obsidian)" 
                strokeWidth={0.5} 
                className="opacity-10" 
              />
            );
          })}

          {/* GHOST COORDINATES (EMPTY STATE) */}
          {pulses.length === 0 && Array.from({ length: 12 }).map((_, i) => {
            const angle = (i * 30);
            return rings.map((yearStr, rIdx) => {
              if (yearStr < Math.floor(oldestYear)) return null;
              const r = (yearStr - zCenterYear) * DISTANCE_PER_YEAR;
              if (r <= 0) return null;
              const pos = getCartesian(center.cx, center.cy, r, angle);
              return (
                <circle 
                  key={`ghost-${i}-${rIdx}`}
                  cx={pos.x} cy={pos.y}
                  r="1.5"
                  fill="var(--obsidian)"
                  opacity="0.1"
                />
              )
            });
          })}
        </g>

        {/* PULSES */}
        <g>
          {pulses.map((pulse) => {
            const Y = getDecimalYear(pulse.date);
            const rawRadius = (Y - zCenterYear) * DISTANCE_PER_YEAR;
            if (rawRadius <= 0) return null; // Behind camera plane
            
            const pos = getCartesian(center.cx, center.cy, rawRadius, pulse.theta);
            const isSealed = sealedPulses.includes(pulse.id);
            const isActive = activePulseId === pulse.id;
            
            return (
              <g 
                key={pulse.id} 
                onClick={() => onOpenInspector(pulse.id, pos)}
                className={"cursor-pointer transition-all duration-500 origin-center " + (!isSealed ? "hover:scale-[1.15]" : "")}
                style={{ transformOrigin: pos.x + "px " + pos.y + "px" }}
              >
                
                {/* 1. SEAR/UNDERLIGHT EFFECT (SEALED + ACTIVE) */}
                {isSealed && isActive && (
                  <>
                    <circle cx={pos.x} cy={pos.y} r="20" fill="var(--cinnabar)" opacity="0.3" className="animate-pulse blur-[10px]" style={{ mixBlendMode: 'screen' }} />
                    <circle cx={pos.x} cy={pos.y} r="12" fill="var(--cinnabar)" opacity="0.6" className="animate-pulse blur-[4px]" />
                  </>
                )}

                {/* 2. HEAT HALO (UNSEALED + ACTIVE) */}
                {!isSealed && isActive && (
                  <>
                    <circle cx={pos.x} cy={pos.y} r="20" fill="var(--amber)" opacity="0.4" className="animate-pulse blur-[10px]" />
                    <circle cx={pos.x} cy={pos.y} r="10" fill="var(--amber)" opacity="0.6" className="animate-pulse blur-[4px]" />
                    {/* Cinnabar Core coming through */}
                    <circle cx={pos.x} cy={pos.y} r="6" fill="var(--cinnabar)" />
                  </>
                )}

                {/* 3. GLOWING POTENTIAL (UNSEALED + INACTIVE) */}
                {!isSealed && !isActive && (
                  <>
                    <circle cx={pos.x} cy={pos.y} r="16" fill="var(--amber)" opacity="0.2" className="animate-pulse blur-[4px]" />
                    <circle cx={pos.x} cy={pos.y} r="6" fill="var(--amber)" />
                  </>
                )}
                
                {/* 4. THE PHYSICAL CRATER (SEALED) */}
                {isSealed && (
                  <circle 
                    cx={pos.x} 
                    cy={pos.y} 
                    r="6" 
                    style={{
                      fill: isActive ? 'transparent' : 'var(--vellum)',
                      stroke: isActive ? 'var(--cinnabar)' : 'var(--bone)',
                      strokeWidth: '1',
                      filter: 'url(#deboss-stamp)'
                    }}
                  />
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
