"use client";

/**
 * A single stage on the builder canvas. Shows what the stage is and — more
 * importantly for judging — which tool it will actually call.
 */

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  LANE_ACCENT,
  LANE_LABEL,
  STAGE_BY_KIND,
  type StageKind,
} from "@/lib/nodes/registry";

export type StageStatus = "idle" | "running" | "done" | "error";

export type StageNodeType = Node<
  { kind: StageKind; status?: StageStatus },
  "stage"
>;

const STATUS_RING: Record<StageStatus, string> = {
  idle: "",
  running: "ring-2 ring-sky-400 ring-offset-2 ring-offset-slate-950",
  done: "ring-2 ring-emerald-400 ring-offset-2 ring-offset-slate-950",
  error: "ring-2 ring-red-400 ring-offset-2 ring-offset-slate-950",
};

export function StageNode({ data, selected }: NodeProps<StageNodeType>) {
  const def = STAGE_BY_KIND[data.kind];
  if (!def) return null;
  const accent = LANE_ACCENT[def.lane];
  const Icon = def.icon;
  const status = data.status ?? "idle";

  return (
    <div
      className={`w-60 rounded-xl border bg-slate-900/95 px-3 py-2.5 shadow-lg transition-all ${
        selected ? "border-white/60" : `${accent.border} border-opacity-60`
      } ${STATUS_RING[status]}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-slate-500"
      />

      <div className="flex items-start gap-2.5">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${accent.text}`} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-slate-100">
            {def.label}
          </div>
          <code className="mt-0.5 block truncate font-mono text-[10px] text-slate-400">
            {def.tool}
          </code>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span
          className={`rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase ${accent.chip}`}
        >
          {LANE_LABEL[def.lane]}
        </span>
        {status === "running" && (
          <span className="text-[10px] text-sky-300">running…</span>
        )}
        {status === "done" && (
          <span className="text-[10px] text-emerald-300">done</span>
        )}
        {status === "error" && (
          <span className="text-[10px] text-red-300">failed</span>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-0 !bg-slate-500"
      />
    </div>
  );
}

export const nodeTypes = { stage: StageNode };
