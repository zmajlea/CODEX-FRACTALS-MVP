import type { PortfolioTemporalObject } from "@/lib/temporal/portfolio-fetch";

/** Ana's Nautilus node colors (Task 3.3 / 2.2) */
export const NAUTILUS_COLORS = {
  date: "#d97706",
  warning: "#ef4444",
  emerald: "#10b981",
  slate: "#3d5560",
  grey: "#9ca3af",
  link: "#DED9D1",
} as const;

export type NautilusGraphNode = {
  id: string;
  type: "document" | "object";
  title: string;
  category?: string | null;
  isLocked?: boolean;
  isSealed?: boolean;
  recordId?: string;
  fileId?: string | null;
  vaultId?: string;
  vaultName?: string;
  parsedDate?: string | null;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
};

export type NautilusGraphLink = {
  source: string;
  target: string;
};

export type NautilusGraphData = {
  nodes: NautilusGraphNode[];
  links: NautilusGraphLink[];
};

export function getNautilusNodeColor(node: NautilusGraphNode): string {
  if (node.type === "document") return NAUTILUS_COLORS.slate;

  if (node.isLocked) return NAUTILUS_COLORS.grey;

  const category = (node.category ?? "").toLowerCase();
  if (category === "warning") return NAUTILUS_COLORS.warning;
  if (node.isSealed) return NAUTILUS_COLORS.emerald;
  if (category === "date") return NAUTILUS_COLORS.date;

  return NAUTILUS_COLORS.date;
}

function hubKey(obj: PortfolioTemporalObject): string {
  return obj.fileId ?? obj.recordId;
}

function dayOfYear(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return 0;
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

/** Build ForceGraph nodes (slate document hubs + orbiting objects). All coords local ~±300px. */
export function buildNautilusGraphData(
  objects: PortfolioTemporalObject[]
): NautilusGraphData {
  const nodes: NautilusGraphNode[] = [];
  const links: NautilusGraphLink[] = [];
  const docByHub = new Map<string, string>();
  const hubPositions = new Map<string, { fx: number; fy: number }>();

  const hubKeys = [...new Set(objects.map((o) => hubKey(o)))];
  const hubCount = Math.max(hubKeys.length, 1);
  const hubRingRadius = Math.min(160, 70 + hubCount * 18);

  hubKeys.forEach((key, index) => {
    const sample = objects.find((o) => hubKey(o) === key)!;
    const angle = (index / hubCount) * Math.PI * 2 - Math.PI / 2;
    const fx = Math.cos(angle) * hubRingRadius;
    const fy = Math.sin(angle) * hubRingRadius;
    const docId = `doc:${key}`;

    docByHub.set(key, docId);
    hubPositions.set(key, { fx, fy });

    nodes.push({
      id: docId,
      type: "document",
      title:
        sample.fileLabel ??
        sample.recordTitle ??
        `Record ${sample.recordId.slice(0, 8)}…`,
      recordId: sample.recordId,
      fileId: sample.fileId,
      vaultId: sample.vaultId,
      vaultName: sample.vaultName,
      fx,
      fy,
    });
  });

  const orbitCounters = new Map<string, number>();

  for (const obj of objects) {
    const key = hubKey(obj);
    const docId = docByHub.get(key);
    const hub = hubPositions.get(key);
    if (!docId || !hub) continue;

    const orbitIndex = orbitCounters.get(key) ?? 0;
    orbitCounters.set(key, orbitIndex + 1);

    const dayOffset = obj.parsedDate ? dayOfYear(obj.parsedDate) : orbitIndex * 24;
    const angle =
      (dayOffset / 365) * Math.PI * 2 + orbitIndex * 0.55 + orbitIndex * 0.15;
    const orbitRadius = 48 + (orbitIndex % 4) * 16;

    const fx = hub.fx + Math.cos(angle) * orbitRadius;
    const fy = hub.fy + Math.sin(angle) * orbitRadius;

    nodes.push({
      id: obj.id,
      type: "object",
      title: obj.isLocked ? "Locked milestone" : (obj.title ?? "Milestone"),
      category: obj.category,
      isLocked: obj.isLocked,
      isSealed: obj.isSealed,
      recordId: obj.recordId,
      fileId: obj.fileId,
      vaultId: obj.vaultId,
      vaultName: obj.vaultName,
      parsedDate: obj.parsedDate,
      fx,
      fy,
    });

    links.push({ source: docId, target: obj.id });
  }

  return { nodes, links };
}

export function findObjectByNodeId(
  objects: PortfolioTemporalObject[],
  nodeId: string
): PortfolioTemporalObject | undefined {
  return objects.find((o) => o.id === nodeId);
}

export function findDocumentNodePayload(node: NautilusGraphNode) {
  if (node.type !== "document" || !node.recordId || !node.vaultId) return null;
  return {
    recordId: node.recordId,
    fileId: node.fileId ?? null,
    vaultId: node.vaultId,
    label: node.title,
    vaultName: node.vaultName ?? "Vault",
  };
}
