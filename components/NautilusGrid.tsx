"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  getCartesian,
  getDecimalYear,
  type NautilusHub,
  type PulseState,
} from "@/lib/temporal/nautilus-map";

export type NautilusPulseInput = {
  id: string;
  r: number;
  theta: number;
  date?: string;
  hubId?: string;
  pulseState?: PulseState;
};

type NautilusProps = {
  isInspectorOpen: boolean;
  activePulseId: string | null;
  onOpenInspector: (pulseId: string, coords: { x: number; y: number }) => void;
  sealedPulses: string[];
  pulses: NautilusPulseInput[];
  hubs?: NautilusHub[];
  showGrid?: boolean;
  invertScroll?: boolean;
  insetLeftClass?: string;
};

const PULSE_COLORS: Record<
  PulseState,
  { halo: string; core: string; opacity: number }
> = {
  emerald: { halo: "var(--emerald)", core: "var(--emerald)", opacity: 0.55 },
  amber: { halo: "var(--amber)", core: "var(--amber)", opacity: 0.5 },
  cinnabar: {
    halo: "var(--cinnabar)",
    core: "var(--cinnabar)",
    opacity: 0.6,
  },
  grey: { halo: "var(--bone)", core: "var(--obsidian)", opacity: 0.25 },
};

export default function NautilusGrid({
  isInspectorOpen,
  activePulseId,
  onOpenInspector,
  sealedPulses,
  pulses,
  hubs = [],
  showGrid = false,
  invertScroll = false,
  insetLeftClass = "left-16",
}: NautilusProps) {
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
  }, []);

  const handleWheel = (e: React.WheelEvent) => {
    setZCenterYear((prev) => {
      const delta = invertScroll ? e.deltaY * -0.002 : e.deltaY * 0.002;
      const nextZ = prev + delta;
      const limitZ = oldestYear - 50 / DISTANCE_PER_YEAR;
      return Math.max(nextZ, limitZ);
    });
  };

  const visibleRingsCount = 8;
  const startIntYear = Math.max(Math.floor(zCenterYear), Math.floor(oldestYear));
  const rings = Array.from({ length: visibleRingsCount }).map(
    (_, i) => startIntYear + i
  );
  const rootYearDisplay = Math.ceil(zCenterYear);

  const resolvePulseState = (pulse: NautilusPulseInput): PulseState => {
    if (pulse.pulseState) return pulse.pulseState;
    if (sealedPulses.includes(pulse.id)) return "emerald";
    return "amber";
  };

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      className={
        "fixed top-16 " +
        insetLeftClass +
        " right-0 bottom-0 z-10 transition-all duration-700 ease-in-out " +
        (isInspectorOpen
          ? "blur-[6px] opacity-30 grayscale-[20%]"
          : "opacity-100 grayscale-0")
      }
      style={{
        boxShadow: "inset 0 0 40px 10px rgba(255, 255, 255, 0.2)",
      }}
    >
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

        {/* Document hubs (slate) */}
        {hubs.length > 0 && (
          <g>
            {hubs.map((hub) => {
              const pos = getCartesian(center.cx, center.cy, hub.r, hub.theta);
              return (
                <g key={`hub-${hub.id}`}>
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r="14"
                    fill="var(--oxford)"
                    opacity="0.85"
                    filter="url(#deboss-stamp)"
                  />
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r="18"
                    fill="none"
                    stroke="var(--oxford)"
                    strokeWidth="0.5"
                    opacity="0.35"
                  />
                  <text
                    x={pos.x}
                    y={pos.y + 28}
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
        )}

        {/* Orbiting pulses */}
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
            const state = resolvePulseState(pulse);
            const colors = PULSE_COLORS[state];
            const isActive = activePulseId === pulse.id;
            const isSealed = sealedPulses.includes(pulse.id) || state === "emerald";
            const activeColor =
              isActive && state !== "grey" ? "cinnabar" : state;
            const activeColors = PULSE_COLORS[activeColor];

            return (
              <g
                key={pulse.id}
                onClick={() => onOpenInspector(pulse.id, pos)}
                className="cursor-pointer transition-all duration-500"
              >
                {isActive && state !== "grey" && (
                  <>
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r="20"
                      fill={activeColors.halo}
                      opacity="0.35"
                      className="animate-pulse blur-[10px]"
                    />
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r="10"
                      fill={activeColors.core}
                      opacity="0.7"
                      className="animate-pulse blur-[4px]"
                    />
                  </>
                )}

                {!isActive && state !== "grey" && (
                  <>
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r="14"
                      fill={colors.halo}
                      opacity={colors.opacity * 0.4}
                      className="blur-[3px]"
                    />
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r="5"
                      fill={colors.core}
                      opacity={colors.opacity}
                    />
                  </>
                )}

                {state === "grey" && (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r="4"
                    fill="var(--bone)"
                    stroke="var(--obsidian)"
                    strokeWidth="0.5"
                    opacity="0.35"
                  />
                )}

                {isSealed && state !== "grey" && !isActive && (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r="5"
                    fill="var(--vellum)"
                    stroke="var(--emerald)"
                    strokeWidth="1"
                    filter="url(#deboss-stamp)"
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
