import "server-only";

/**
 * Entry point for a run. The graph the user drew decides what executes; when
 * no graph is supplied (an API caller, say) the flagship template stands in.
 */

import { runGraph, type RunGraph } from "@/lib/graph";
import { DEFAULT_TEMPLATE } from "@/lib/templates";
import type { PublishResult, TraceEvent } from "@/lib/baton";

export interface PipelineOptions {
  goal: string;
  writeBack: boolean;
  /** Dataset URNs the user picked when an earlier run paused to ask. */
  selections?: string[];
  /** The canvas graph. Falls back to the default relay when absent. */
  graph?: RunGraph;
}

export function defaultGraph(): RunGraph {
  return {
    nodes: DEFAULT_TEMPLATE.nodes.map((n) => ({ id: n.id, kind: n.kind })),
    edges: DEFAULT_TEMPLATE.edges.map((e) => ({
      source: e.source,
      target: e.target,
    })),
  };
}

export async function runPipeline(
  options: PipelineOptions,
  onEvent: (event: TraceEvent) => void,
): Promise<PublishResult> {
  return runGraph(options.graph ?? defaultGraph(), options, onEvent);
}
