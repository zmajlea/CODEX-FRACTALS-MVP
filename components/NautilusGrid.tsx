"use client";

import dynamic from "next/dynamic";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import type { PortfolioTemporalObject } from "@/lib/temporal/portfolio-fetch";
import {
  buildNautilusGraphData,
  findDocumentNodePayload,
  findObjectByNodeId,
  getNautilusNodeColor,
  type NautilusGraphNode,
} from "@/lib/temporal/nautilus-graph-data";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

type NautilusGridProps = {
  objects: PortfolioTemporalObject[];
  activeNodeId?: string | null;
  onDocumentSelect: (payload: {
    recordId: string;
    fileId: string | null;
    vaultId: string;
    label: string;
    vaultName: string;
  }) => void;
  onObjectSelect: (obj: PortfolioTemporalObject) => void;
  insetLeftClass?: string;
  insetRightClass?: string;
};

type GraphRef = {
  centerAt: (x: number, y: number, ms?: number) => void;
  zoom: (scale: number, ms?: number) => void;
  zoomToFit: (ms?: number, padding?: number) => void;
};

export default function NautilusGrid({
  objects,
  activeNodeId,
  onDocumentSelect,
  onObjectSelect,
  insetLeftClass = "left-80",
  insetRightClass = "right-0",
}: NautilusGridProps) {
  const graphRef = useRef<GraphRef | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomTimerRef = useRef<number | null>(null);

  const graphData = useMemo(() => buildNautilusGraphData(objects), [objects]);

  useEffect(() => {
    return () => {
      if (zoomTimerRef.current) window.clearTimeout(zoomTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      graphRef.current?.zoomToFit(800, 80);
    }, 400);
    return () => window.clearTimeout(t);
  }, [graphData]);

  const zoomToNode = useCallback((node: NautilusGraphNode) => {
    const x = node.x ?? node.fx ?? 0;
    const y = node.y ?? node.fy ?? 0;
    graphRef.current?.centerAt(x, y, 600);
    graphRef.current?.zoom(2.4, 600);
  }, []);

  const handleNodeClick = useCallback(
    (node: NautilusGraphNode) => {
      zoomToNode(node);

      if (zoomTimerRef.current) window.clearTimeout(zoomTimerRef.current);
      zoomTimerRef.current = window.setTimeout(() => {
        if (node.type === "document") {
          const payload = findDocumentNodePayload(node);
          if (payload) onDocumentSelect(payload);
          return;
        }
        const obj = findObjectByNodeId(objects, node.id);
        if (obj) onObjectSelect(obj);
      }, 650);
    },
    [objects, onDocumentSelect, onObjectSelect, zoomToNode]
  );

  const drawNode = useCallback(
    (node: NautilusGraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const color = getNautilusNodeColor(node);
      const isDocument = node.type === "document";
      const isActive = activeNodeId === node.id;
      const radius = (isDocument ? 14 : 8) / globalScale;

      if (isActive && !isDocument) {
        ctx.beginPath();
        ctx.arc(x, y, radius * 2.2, 0, 2 * Math.PI);
        ctx.fillStyle = `${color}33`;
        ctx.fill();
      }

      ctx.beginPath();
      if (isDocument) {
        const size = radius * 1.4;
        ctx.rect(x - size, y - size, size * 2, size * 2);
      } else {
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
      }
      ctx.fillStyle = color;
      ctx.fill();

      if (isDocument) {
        ctx.strokeStyle = "#1A1A1B22";
        ctx.lineWidth = 1 / globalScale;
        ctx.stroke();
      }

      const label = node.title.length > 28 ? `${node.title.slice(0, 26)}…` : node.title;
      const fontSize = Math.max((isDocument ? 11 : 9) / globalScale, 3);
      ctx.font = `${fontSize}px JetBrains Mono, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#1A1A1B";
      ctx.fillText(label, x, y + radius + 4 / globalScale);
    },
    [activeNodeId]
  );

  return (
    <div
      ref={containerRef}
      className={`fixed top-16 ${insetLeftClass} ${insetRightClass} bottom-0 z-10 bg-vellum transition-all duration-500`}
      style={{
        boxShadow: "inset 0 0 40px 10px rgba(255, 255, 255, 0.2)",
      }}
    >
      {objects.length === 0 ? (
        <div className="h-full flex items-center justify-center font-data text-sm text-obsidian/40 px-8 text-center">
          Seal milestones from the Temporal Extraction Engine to populate the Nautilus.
        </div>
      ) : (
        <ForceGraph2D
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ref={graphRef as any}
          graphData={graphData}
          backgroundColor="rgba(252, 251, 249, 0)"
          nodeRelSize={6}
          linkColor={() => "#DED9D1"}
          linkWidth={1.2}
          linkDirectionalParticles={1}
          linkDirectionalParticleWidth={2}
          linkDirectionalParticleSpeed={0.004}
          cooldownTicks={120}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          onNodeClick={(node) => handleNodeClick(node as NautilusGraphNode)}
          nodeCanvasObject={(node, ctx, globalScale) =>
            drawNode(node as NautilusGraphNode, ctx, globalScale)
          }
          nodePointerAreaPaint={(node, color, ctx) => {
            const n = node as NautilusGraphNode;
            const x = n.x ?? 0;
            const y = n.y ?? 0;
            const r = n.type === "document" ? 18 : 14;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, 2 * Math.PI);
            ctx.fill();
          }}
        />
      )}
    </div>
  );
}
