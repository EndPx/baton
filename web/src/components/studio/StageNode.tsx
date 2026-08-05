"use client";

/**
 * A stage on the canvas. The same node is both the thing you wire up and the
 * thing that lights up while the pipeline runs — status and the last trace
 * line are rendered right here.
 */

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { AlertTriangle } from "lucide-react";
import {
  LANE_ACCENT,
  LANE_LABEL,
  STAGE_BY_KIND,
  type StageKind,
} from "@/lib/nodes/registry";
import type { StageStatus } from "@/lib/traceMapping";

export type StageNodeType = Node<
  {
    kind: StageKind;
    status?: StageStatus;
    detail?: string;
    /** True when a blocking rule violation points at this stage. */
    hasIssue?: boolean;
  },
  "stage"
>;

const STATUS_RING: Record<StageStatus, string> = {
  idle: "",
  running: "ring-2 ring-sky-400 ring-offset-2 ring-offset-slate-950",
  done: "ring-2 ring-emerald-400 ring-offset-2 ring-offset-slate-950",
  skipped:
    "opacity-60 ring-1 ring-slate-600 ring-offset-2 ring-offset-slate-950",
  error: "ring-2 ring-red-400 ring-offset-2 ring-offset-slate-950",
};

const STATUS_TEXT: Record<StageStatus, string> = {
  idle: "",
  running: "text-sky-300",
  done: "text-emerald-300",
  skipped: "text-slate-400",
  error: "text-red-300",
};

const STATUS_LABEL: Record<StageStatus, string> = {
  idle: "",
  running: "running…",
  done: "done",
  skipped: "skipped",
  error: "failed",
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
        data.hasIssue
          ? "border-amber-400/80"
          : selected
            ? "border-white/60"
            : accent.border
      } ${STATUS_RING[status]}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-slate-500"
      />

      <div className="flex items-start gap-2.5">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${accent.text}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-slate-100">
              {def.label}
            </span>
            {data.hasIssue && (
              <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
            )}
          </div>
          <code className="mt-0.5 block truncate font-mono text-[10px] text-slate-400">
            {def.tool}
          </code>
        </div>
      </div>

      {data.detail && status !== "idle" && (
        <p
          className={`mt-1.5 line-clamp-2 text-[10px] leading-snug ${STATUS_TEXT[status]}`}
        >
          {data.detail}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between">
        <span
          className={`rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase ${accent.chip}`}
        >
          {LANE_LABEL[def.lane]}
        </span>
        {status !== "idle" && (
          <span className={`text-[10px] ${STATUS_TEXT[status]}`}>
            {STATUS_LABEL[status]}
          </span>
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
