"use client";

/**
 * TraceFlow — live flow diagram of the Baton pipeline.
 *
 * Renders one column per lane (Context, Codegen, Publisher); nodes appear
 * as TraceEvents stream in, colored by status. This is a direct visual
 * reflection of the real MCP/LLM calls — never a decorative animation.
 */

import { useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Lane, TraceEvent } from "@/lib/baton";

const LANE_X: Record<Lane, number> = { context: 0, codegen: 320, publisher: 640 };
const LANE_LABEL: Record<Lane, string> = {
  context: "Context agent",
  codegen: "Codegen agent",
  publisher: "Publisher agent",
};

type NodeStatus = "running" | "done" | "error";

const STATUS_STYLE: Record<NodeStatus, React.CSSProperties> = {
  running: { background: "#1e3a5f", border: "2px solid #38bdf8", color: "#e0f2fe" },
  done: { background: "#14532d", border: "2px solid #4ade80", color: "#dcfce7" },
  error: { background: "#7f1d1d", border: "2px solid #f87171", color: "#fee2e2" },
};

export function TraceFlow({ events }: { events: TraceEvent[] }) {
  const { nodes, edges } = useMemo(() => {
    const nodeOrder: string[] = [];
    const status = new Map<string, NodeStatus>();
    const lastLabel = new Map<string, string>();
    const laneOf = new Map<string, Lane>();

    for (const ev of events) {
      if (ev.node === "handoff") continue;
      const key = `${ev.lane}:${ev.node}`;
      if (!nodeOrder.includes(key)) {
        nodeOrder.push(key);
        laneOf.set(key, ev.lane);
      }
      if (ev.type === "error") status.set(key, "error");
      else if (ev.type === "node_complete") status.set(key, "done");
      else if (!status.has(key) || status.get(key) === "running") {
        status.set(key, "running");
      }
      lastLabel.set(key, ev.label);
    }

    const laneCount: Record<Lane, number> = { context: 0, codegen: 0, publisher: 0 };
    const nodes: Node[] = nodeOrder.map((key) => {
      const lane = laneOf.get(key)!;
      const row = laneCount[lane]++;
      const st = status.get(key) ?? "running";
      const nodeName = key.split(":")[1];
      return {
        id: key,
        position: { x: LANE_X[lane], y: 70 + row * 110 },
        data: {
          label: (
            <div style={{ fontSize: 11, lineHeight: 1.3 }}>
              <div style={{ fontWeight: 700 }}>
                {st === "running" ? "⏳ " : st === "done" ? "✅ " : "❌ "}
                {nodeName.replace(/_/g, " ")}
              </div>
              <div style={{ opacity: 0.85, marginTop: 2 }}>
                {(lastLabel.get(key) ?? "").slice(0, 70)}
              </div>
            </div>
          ),
        },
        style: {
          ...STATUS_STYLE[st],
          borderRadius: 10,
          padding: 8,
          width: 260,
        },
      };
    });

    // Lane headers as static nodes
    (Object.keys(LANE_X) as Lane[]).forEach((lane) => {
      nodes.push({
        id: `hdr:${lane}`,
        position: { x: LANE_X[lane], y: 0 },
        data: { label: LANE_LABEL[lane] },
        draggable: false,
        selectable: false,
        style: {
          background: "transparent",
          border: "none",
          color: "#94a3b8",
          fontWeight: 700,
          fontSize: 13,
          width: 260,
          textAlign: "center",
        },
      });
    });

    const edges: Edge[] = [];
    for (let i = 1; i < nodeOrder.length; i++) {
      edges.push({
        id: `e${i}`,
        source: nodeOrder[i - 1],
        target: nodeOrder[i],
        animated: status.get(nodeOrder[i]) === "running",
        style: { stroke: "#64748b" },
      });
    }

    return { nodes, edges };
  }, [events]);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
