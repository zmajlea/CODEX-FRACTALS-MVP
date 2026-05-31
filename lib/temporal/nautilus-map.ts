import type { PortfolioTemporalObject } from "@/lib/temporal/portfolio-fetch";

export type PulseState = "emerald" | "amber" | "cinnabar" | "grey";

export type NautilusPulse = {
  id: string;
  r: number;
  theta: number;
  date?: string;
  hubId: string;
  pulseState: PulseState;
  vaultName?: string;
  title?: string | null;
};

export type NautilusHub = {
  id: string;
  label: string;
  r: number;
  theta: number;
  vaultName: string;
  pulseCount: number;
};

export const getDecimalYear = (dateStr?: string | null) => {
  if (!dateStr) return new Date().getFullYear();
  const parts = dateStr.split("-");
  return parseInt(parts[0], 10) + (parseInt(parts[1] || "1", 10) - 1) / 12;
};

export const getCartesian = (
  cx: number,
  cy: number,
  r: number,
  theta: number
) => {
  const rad = ((theta - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
};

function hubKey(obj: PortfolioTemporalObject): string {
  return obj.fileId ?? obj.recordId;
}

function hubLabel(obj: PortfolioTemporalObject): string {
  return (
    obj.fileLabel ??
    obj.recordTitle ??
    `${obj.vaultName} · ${obj.recordId.slice(0, 8)}…`
  );
}

function dayOfYear(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return 0;
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

function pulseStateFor(obj: PortfolioTemporalObject): PulseState {
  if (obj.isLocked) return "grey";
  if (obj.isSealed) return "emerald";
  return "amber";
}

/** Map portfolio objects to document hubs (slate) and orbiting date pulses. */
export function mapPortfolioToNautilus(objects: PortfolioTemporalObject[]): {
  hubs: NautilusHub[];
  pulses: NautilusPulse[];
  sealedPulseIds: string[];
} {
  const hubMap = new Map<
    string,
    { obj: PortfolioTemporalObject; count: number }
  >();

  for (const obj of objects) {
    const key = hubKey(obj);
    const existing = hubMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      hubMap.set(key, { obj, count: 1 });
    }
  }

  const hubEntries = Array.from(hubMap.entries());
  const hubCount = Math.max(hubEntries.length, 1);
  const HUB_RADIUS = 180;

  const hubs: NautilusHub[] = hubEntries.map(([id, { obj, count }], index) => {
    const theta = (360 / hubCount) * index;
    return {
      id,
      label: hubLabel(obj),
      r: HUB_RADIUS,
      theta,
      vaultName: obj.vaultName,
      pulseCount: count,
    };
  });

  const hubThetaById = new Map(hubs.map((h) => [h.id, h.theta]));
  const hubIndexById = new Map(hubs.map((h, i) => [h.id, i]));

  const orbitCounters = new Map<string, number>();
  const pulses: NautilusPulse[] = [];
  const sealedPulseIds: string[] = [];

  for (const obj of objects) {
    const key = hubKey(obj);
    const hubTheta = hubThetaById.get(key) ?? 0;
    const orbitIndex = orbitCounters.get(key) ?? 0;
    orbitCounters.set(key, orbitIndex + 1);

    const dateStr = obj.parsedDate ?? obj.createdAt.slice(0, 10);
    const dayOffset = obj.parsedDate ? (dayOfYear(obj.parsedDate) % 12) * 4 : 0;
    const spread = (hubIndexById.get(key) ?? 0) * 3 + orbitIndex * 7;
    const theta = (hubTheta + dayOffset + spread) % 360;

    if (obj.isSealed) sealedPulseIds.push(obj.id);

    pulses.push({
      id: obj.id,
      r: 0,
      theta,
      date: dateStr,
      hubId: key,
      pulseState: pulseStateFor(obj),
      vaultName: obj.vaultName,
      title: obj.title,
    });
  }

  return { hubs, pulses, sealedPulseIds };
}
