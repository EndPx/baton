"use client";

/**
 * The orchestration log: every trace event as it streams in, so the hand-offs
 * between the three agents are visible rather than implied by the canvas alone.
 */

import { useEffect, useRef } from "react";
import type { Lane, TraceEvent } from "@/lib/baton";

const LANE_DOT: Record<Lane, string> = {
  context: "bg-sky-400",
  codegen: "bg-violet-400",
  publisher: "bg-emerald-400",
};

const LANE_TEXT: Record<Lane, string> = {
  context: "text-sky-300",
  codegen: "text-violet-300",
  publisher: "text-emerald-300",
};

const TYPE_GLYPH: Record<string, string> = {
  node_start: "▶",
  tool_call: "→",
  tool_result: "←",
  node_complete: "✓",
  node_skipped: "⊘",
  handoff: "⇥",
  error: "✕",
  pipeline_complete: "★",
};

export function RunLog({ events }: { events: TraceEvent[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [events.length]);

  if (events.length === 0) {
    return (
      <p className="px-3 py-4 text-xs leading-relaxed text-slate-500">
        Run the pipeline and every MCP call, LLM call and hand-off shows up here
        as it happens.
      </p>
    );
  }

  const t0 = events[0].ts;

  return (
    <ol className="space-y-1 px-3 py-2 font-mono text-[11px]">
      {events.map((event) => {
        const isHandoff = event.type === "handoff";
        const elapsed = ((event.ts - t0) / 1000).toFixed(1);
        return (
          <li
            key={event.id}
            className={`flex gap-2 rounded px-1.5 py-1 ${
              isHandoff ? "bg-white/5" : ""
            } ${event.type === "error" ? "bg-red-950/50" : ""}`}
          >
            <span className="w-8 shrink-0 text-slate-600">{elapsed}s</span>
            <span
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${LANE_DOT[event.lane]}`}
              aria-hidden
            />
            <span className={`shrink-0 ${LANE_TEXT[event.lane]}`}>
              {TYPE_GLYPH[event.type] ?? "·"}
            </span>
            <span
              className={`min-w-0 break-words ${
                event.type === "error"
                  ? "text-red-200"
                  : isHandoff
                    ? "font-semibold text-slate-200"
                    : "text-slate-400"
              }`}
            >
              {event.label}
            </span>
          </li>
        );
      })}
      <div ref={endRef} />
    </ol>
  );
}
