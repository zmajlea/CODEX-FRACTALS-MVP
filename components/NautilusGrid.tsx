"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PortfolioTemporalObject } from "@/lib/temporal/portfolio-fetch";
import {
  getCartesian,
  getDecimalYear,
  mapPortfolioToNautilus,
  type PulseState,
} from "@/lib/temporal/nautilus-map";

type NautilusGridProps = {
  objects: PortfolioTemporalObject[];
  activePulseId?: string | null;
  onPulseClick: (id: string, coords: { x: number; y: number }) => void;
  onHubClick?: (hubId: string, coords: { x: number; y: number }) => void;
  isInspectorOpen?: boolean;
  showGrid?: boolean;
  invertScroll?: boolean;
  insetLeftClass?: string;
  insetRightClass?: string;
};

const PULSE_STYLES: Record<
  PulseState,
  { fill: string; halo: string; sealed?: boolean }
> = {
  emerald: { fill: "var(--emerald)", halo: "var(--emerald)", sealed: true },
  amber: { fill: "var(--amber)", halo: "var(--amber)" },
  cinnabar: { fill: "var(--cinnabar)", halo: "var(--cinnabar)" },
  grey: { fill: "var(--bone)", halo: "var(--obsidian)" },
};

export default function NautilusGrid({
  objects,
  activePulseId,
  onPulseClick,
  onHubClick,
  isInspectorOpen = false,
  showGrid = true,
  invertScroll = false,
  insetLeftClass = "left-80",
  insetRightClass = "right-0",
}: NautilusGridProps) {
  const { hubs, pulses, sealedPulseIds, totalPulseCount, displayedPulseCount } =
    useMemo(() => mapPortfolioToNautilus(objects), [objects]);

  const isSampled = totalPulseCount > displayedPulseCount;

  const [center, setCenter] = useState({ cx: 500, cy: 500 });
  const oldestYear =
    pulses.length > 0
      ? Math.min(...pulses.map((p) => getDecimalYear(p.date)))
      : new Date().getFullYear() - 1;

  const [zCenterYear, setZCenterYear] = useState(oldestYear);
  const containerRef = useRef<HTMLDivElement>(null);

  const DISTANCE_PER_YEAR = 120;
  const FRAME_RADIUS = DISTANCE_PER_YEAR * 2;

  useEffect(() => {
    setZCenterYear(oldestYear);
  }, [oldestYear]);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setCenter({
          cx: containerRef.current.clientWidth / 2,
          cy: containerRef.current.clientHeight / 2,
        });
      }
    };
    window.addEventListener("resize", updateSize);
    setTimeout(updateSize, 50);
    return () => window.removeEventListener("resize", updateSize);
  }, [insetLeftClass, insetRightClass]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZCenterYear((prev) => {
      const delta = invertScroll ? e.deltaY * -0.002 : e.deltaY * 0.002;
      const limitZ = oldestYear - 50 / DISTANCE_PER_YEAR;
      return Math.max(prev + delta, limitZ);
    });
  };

  const visibleRingsCount = 8;
  const startIntYear = Math.max(Math.floor(zCenterYear), Math.floor(oldestYear));
  const rings = Array.from({ length: visibleRingsCount }).map(
    (_, i) => startIntYear + i
  );
  const rootYearDisplay = Math.ceil(zCenterYear);

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      className={
        "fixed top-16 " +
        insetLeftClass +
        " " +
        insetRightClass +
        " bottom-0 z-10 transition-all duration-700 ease-in-out " +
        (isInspectorOpen
          ? "blur-[6px] opacity-30 grayscale-[20%]"
          : "opacity-100 grayscale-0")
      }
      style={{ boxShadow: "inset 0 0 40px 10px rgba(255, 255, 255, 0.2)" }}
    >
      {objects.length === 0 ? (
        <div className="h-full flex items-center justify-center font-data text-sm text-obsidian/40 px-8 text-center">
          Seal Date milestones from the Temporal Extraction Engine to populate the
          Nautilus.
        </div>
      ) : (
        <>
        {isSampled && (
          <p className="absolute top-3 right-4 z-20 font-data text-[9px] uppercase tracking-ultra text-obsidian/40 bg-vellum/90 px-2 py-1 border border-bone/60">
            Nautilus · {displayedPulseCount} of {totalPulseCount} pulses
          </p>
        )}
        <svg className="w-full h-full cursor-grab active:cursor-grabbing">
          <defs>
            <filter id="deboss-stamp" x="-20%" y="-20%" width="140%" height="140%">
              <feOffset dx="1" dy="1" />
              <feGaussianBlur stdDeviation="1" result="offset-blur" />
              <feComposite
                operator="out"
                in="SourceGraphic"
                in2="offset-blur"
                result="inverse"
              />
              <feFlood
                floodColor="rgba(26,26,27,0.15)"
                floodOpacity="1"
                result="color"
              />
              <feComposite operator="in" in="color" in2="inverse" result="shadow" />
              <feComposite operator="over" in="shadow" in2="SourceGraphic" />
            </filter>
          </defs>

          <g className="transition-all duration-[50ms]">
            {rings.map((yearStr) => {
              if (yearStr < Math.floor(oldestYear)) return null;
              const r = (yearStr - zCenterYear) * DISTANCE_PER_YEAR;
              if (r <= 0) return null;

              const isFrameRing =
                Math.abs(r - FRAME_RADIUS) < DISTANCE_PER_YEAR / 2;

              return (
                <circle
                  key={`ring-${yearStr}`}
                  cx={center.cx}
                  cy={center.cy}
                  r={r}
                  fill="none"
                  stroke={isFrameRing ? "var(--obsidian)" : "var(--bone)"}
                  strokeWidth={isFrameRing ? "1" : "0.5"}
                  opacity={isFrameRing ? "0.4" : "0.7"}
                />
              );
            })}

            <text
              x={center.cx}
              y={center.cy + 10}
              textAnchor="middle"
              className="font-head text-[32px] fill-obsidian tracking-wide opacity-60 font-bold pointer-events-none"
            >
              {rootYearDisplay}
            </text>
            <circle
              cx={center.cx}
              cy={center.cy}
              r="3"
              fill="var(--obsidian)"
              opacity="0.3"
            />

            {showGrid &&
              Array.from({ length: 12 }).map((_, i) => {
                const angle = i * 30;
                const startPos = getCartesian(center.cx, center.cy, 50, angle);
                const endPos = getCartesian(
                  center.cx,
                  center.cy,
                  visibleRingsCount * DISTANCE_PER_YEAR,
                  angle
                );
                return (
                  <line
                    key={`axis-${i}`}
                    x1={startPos.x}
                    y1={startPos.y}
                    x2={endPos.x}
                    y2={endPos.y}
                    stroke="var(--obsidian)"
                    strokeWidth={0.5}
                    className="opacity-10"
                  />
                );
              })}
          </g>

          {/* Slate document hubs (inner ring only — origin stays clear for year HUD) */}
          <g>
            {hubs.filter((hub) => hub.r > 0).map((hub) => {
              const pos = getCartesian(center.cx, center.cy, hub.r, hub.theta);
              return (
                <g
                  key={`hub-${hub.id}`}
                  className="cursor-pointer"
                  onClick={() => onHubClick?.(hub.id, pos)}
                >
                  <rect
                    x={pos.x - 12}
                    y={pos.y - 12}
                    width="24"
                    height="24"
                    fill="#3d5560"
                    opacity="0.9"
                    filter="url(#deboss-stamp)"
                  />
                  <rect
                    x={pos.x - 14}
                    y={pos.y - 14}
                    width="28"
                    height="28"
                    fill="none"
                    stroke="#3d5560"
                    strokeWidth="0.5"
                    opacity="0.35"
                  />
                  <text
                    x={pos.x}
                    y={pos.y + 26}
                    textAnchor="middle"
                    className="font-data text-[8px] fill-obsidian/60 uppercase tracking-widest pointer-events-none"
                  >
                    {hub.label.length > 22
                      ? `${hub.label.slice(0, 20)}…`
                      : hub.label}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Orbiting date pulses */}
          <g>
            {pulses.map((pulse) => {
              const Y = getDecimalYear(pulse.date);
              const rawRadius = (Y - zCenterYear) * DISTANCE_PER_YEAR;
              if (rawRadius <= 0) return null;

              const pos = getCartesian(
                center.cx,
                center.cy,
                rawRadius,
                pulse.theta
              );
              const style = PULSE_STYLES[pulse.pulseState];
              const isActive = activePulseId === pulse.id;
              const isSealed =
                pulse.pulseState === "emerald" ||
                sealedPulseIds.includes(pulse.id);

              return (
                <g
                  key={pulse.id}
                  onClick={() => onPulseClick(pulse.id, pos)}
                  className="cursor-pointer"
                >
                  {isActive && pulse.pulseState !== "grey" && (
                    <>
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r="20"
                        fill={style.halo}
                        opacity="0.35"
                        className="animate-pulse blur-[8px]"
                      />
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r="10"
                        fill={style.fill}
                        opacity="0.7"
                        className="animate-pulse blur-[3px]"
                      />
                    </>
                  )}

                  {!isActive && pulse.pulseState !== "grey" && (
                    <>
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r="14"
                        fill={style.halo}
                        opacity="0.25"
                        className="blur-[2px]"
                      />
                      {!isSealed && (
                        <circle
                          cx={pos.x}
                          cy={pos.y}
                          r="6"
                          fill={style.fill}
                        />
                      )}
                    </>
                  )}

                  {pulse.pulseState === "grey" && (
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r="4"
                      fill="var(--bone)"
                      stroke="var(--obsidian)"
                      strokeWidth="0.5"
                      opacity="0.4"
                    />
                  )}

                  {isSealed && !isActive && (
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r="6"
                      fill="var(--vellum)"
                      stroke="var(--emerald)"
                      strokeWidth="1.5"
                      filter="url(#deboss-stamp)"
                    />
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        </>
      )}
    </div>
  );
}
