/**
 * Maps the backend's trace events onto the stages drawn on the canvas, so the
 * pipeline you built is the same thing that lights up while it runs.
 *
 * The backend emits node names per lane (resolve_entities, validate, …); the
 * canvas speaks in stage kinds (search_entities, validate_sql, …). One backend
 * node can drive more than one stage — write_back covers both the tag and the
 * description stages.
 */

import type { TraceEvent } from "@/lib/baton";
import type { StageKind } from "@/lib/nodes/registry";

export type StageStatus =
  | "idle"
  | "running"
  | "done"
  | "skipped"
  | "error";

export interface StageRunState {
  status: StageStatus;
  /** Last human-readable line seen for this stage. */
  detail?: string;
}

const NODE_TO_KINDS: Record<string, StageKind[]> = {
  resolve_entities: ["search_entities"],
  fetch_schema: ["fetch_schema"],
  fetch_lineage: ["fetch_lineage"],
  dataset_queries: ["dataset_queries"],
  generate_sql: ["generate_sql", "generate_docs"],
  validate: ["validate_sql"],
  package_output: ["package_dbt"],
  write_back: ["write_back_tags", "write_back_description"],
};

export function kindsForNode(node: string): StageKind[] {
  return NODE_TO_KINDS[node] ?? [];
}

/**
 * Fold a stream of trace events into per-stage run state. Later events win,
 * except that a completed stage is not dragged back to running by a trailing
 * tool_result — only an explicit restart (a retry) reopens it.
 */
export function deriveStageStates(
  events: TraceEvent[],
): Partial<Record<StageKind, StageRunState>> {
  const states: Partial<Record<StageKind, StageRunState>> = {};

  for (const event of events) {
    if (event.node === "handoff") continue;
    for (const kind of kindsForNode(event.node)) {
      const prev = states[kind];
      const settled = prev?.status === "done" || prev?.status === "error";
      let status: StageStatus = prev?.status ?? "idle";

      if (event.type === "error") {
        status = "error";
      } else if (event.type === "node_skipped") {
        status = "skipped";
      } else if (event.type === "node_complete") {
        status = "done";
      } else if (event.type === "node_start") {
        // A retry (validation failure → regenerate) reopens a finished stage.
        status = "running";
      } else if (!settled) {
        status = "running";
      }

      states[kind] = { status, detail: event.label };
    }
  }

  return states;
}
