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
  /** Visual radius from center (0 = hub at origin) */
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
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

function pulseStateFor(obj: PortfolioTemporalObject): PulseState {
  if (obj.isLocked) return "grey";
  const category = (obj.category ?? "").toLowerCase();
  if (category === "warning") return "cinnabar";
  if (obj.isSealed) return "emerald";
  return "amber";
}

/** Max individual pulse dots rendered (ledger still shows all). */
export const NAUTILUS_PULSE_CAP = 200;

function sampleForNautilusPulses(
  objects: PortfolioTemporalObject[],
  cap: number
): PortfolioTemporalObject[] {
  if (objects.length <= cap) return objects;
  const step = objects.length / cap;
  const sampled: PortfolioTemporalObject[] = [];
  for (let i = 0; i < cap; i++) {
    sampled.push(objects[Math.floor(i * step)]);
  }
  return sampled;
}

/** Map portfolio Date objects → slate hubs + orbiting pulses (radial math). */
export function mapPortfolioToNautilus(objects: PortfolioTemporalObject[]): {
  hubs: NautilusHub[];
  pulses: NautilusPulse[];
  sealedPulseIds: string[];
  totalPulseCount: number;
  displayedPulseCount: number;
} {
  const hubMap = new Map<
    string,
    { obj: PortfolioTemporalObject; count: number }
  >();

  for (const obj of objects) {
    const key = hubKey(obj);
    const existing = hubMap.get(key);
    if (existing) existing.count += 1;
    else hubMap.set(key, { obj, count: 1 });
  }

  const hubEntries = Array.from(hubMap.entries());
  const hubCount = Math.max(hubEntries.length, 1);
  /** Single document sits at the nautilus origin; multiple docs share an inner ring */
  const hubRingRadius = hubCount === 1 ? 0 : 72;

  const hubs: NautilusHub[] = hubEntries.map(([id, { obj, count }], index) => {
    const theta = hubCount === 1 ? 0 : (360 / hubCount) * index;
    return {
      id,
      label: hubLabel(obj),
      r: hubRingRadius,
      theta,
      vaultName: obj.vaultName,
      pulseCount: count,
    };
  });

  const hubThetaById = new Map(hubs.map((h) => [h.id, h.theta]));
  const orbitCounters = new Map<string, number>();
  const pulses: NautilusPulse[] = [];
  const sealedPulseIds: string[] = [];

  const pulseObjects = sampleForNautilusPulses(objects, NAUTILUS_PULSE_CAP);

  for (const obj of pulseObjects) {
    const key = hubKey(obj);
    const hubTheta = hubThetaById.get(key) ?? 0;
    const orbitIndex = orbitCounters.get(key) ?? 0;
    orbitCounters.set(key, orbitIndex + 1);

    const dateStr = obj.parsedDate ?? obj.createdAt.slice(0, 10);
    const dayAngle = obj.parsedDate
      ? (dayOfYear(obj.parsedDate) / 365) * 360
      : orbitIndex * 24;
    const spread = orbitIndex * 8;
    const theta = (hubTheta + dayAngle + spread) % 360;

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

  return {
    hubs,
    pulses,
    sealedPulseIds,
    totalPulseCount: objects.length,
    displayedPulseCount: pulseObjects.length,
  };
}

export function hubIdToDocumentPayload(
  objects: PortfolioTemporalObject[],
  hubId: string
) {
  const sample = objects.find((o) => hubKey(o) === hubId);
  if (!sample) return null;
  return {
    recordId: sample.recordId,
    fileId: sample.fileId,
    vaultId: sample.vaultId,
    label: hubLabel(sample),
    vaultName: sample.vaultName,
  };
}
