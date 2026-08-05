import "server-only";

/**
 * Runs the graph you drew.
 *
 * Stages execute in topological order, so the edges on the canvas decide what
 * happens when. Every emitted event carries the id of the node it came from,
 * which is what lets the exact box you placed light up — including the second
 * one, if your graph holds two of the same stage.
 */

import { STAGE_BY_KIND, type Lane, type StageKind } from "@/lib/nodes/registry";
import { STAGE_HANDLERS, type RunState } from "@/lib/stages";
import type { PublishResult, TraceEvent, TraceEmitter } from "@/lib/baton";

export interface RunGraphNode {
  id: string;
  kind: StageKind;
}

export interface RunGraphEdge {
  source: string;
  target: string;
}

export interface RunGraph {
  nodes: RunGraphNode[];
  edges: RunGraphEdge[];
}

const LANE_RANK: Record<Lane, number> = {
  context: 0,
  codegen: 1,
  publisher: 2,
};

const LANE_LABEL: Record<Lane, string> = {
  context: "Context",
  codegen: "Codegen",
  publisher: "Publisher",
};

/**
 * Kahn's algorithm, with ties broken by lane then by the order the nodes were
 * given. Two graphs that mean the same thing therefore produce the same trace,
 * which matters when the trace is the demo.
 */
export function topoSort(graph: RunGraph): RunGraphNode[] {
  const position = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const indegree = new Map(graph.nodes.map((n) => [n.id, 0]));
  const children = new Map<string, string[]>();

  for (const edge of graph.edges) {
    if (!indegree.has(edge.source) || !indegree.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    children.set(edge.source, [
      ...(children.get(edge.source) ?? []),
      edge.target,
    ]);
  }

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const rank = (id: string) => {
    const node = byId.get(id)!;
    return [
      LANE_RANK[STAGE_BY_KIND[node.kind].lane],
      position.get(id) ?? 0,
    ] as const;
  };

  const ready = graph.nodes
    .filter((n) => (indegree.get(n.id) ?? 0) === 0)
    .map((n) => n.id);

  const sorted: RunGraphNode[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => {
      const [la, pa] = rank(a);
      const [lb, pb] = rank(b);
      return la - lb || pa - pb;
    });
    const id = ready.shift()!;
    sorted.push(byId.get(id)!);
    for (const child of children.get(id) ?? []) {
      const left = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, left);
      if (left === 0) ready.push(child);
    }
  }

  if (sorted.length !== graph.nodes.length) {
    throw new Error(
      "The pipeline has a loop — it runs once, front to back, so every stage needs a path from the start.",
    );
  }
  return sorted;
}

export interface RunGraphOptions {
  goal: string;
  writeBack: boolean;
  selections?: string[];
}

export async function runGraph(
  graph: RunGraph,
  options: RunGraphOptions,
  onEvent: (event: TraceEvent) => void,
): Promise<PublishResult> {
  const order = topoSort(graph);

  const state: RunState = {
    goal: options.goal,
    writeBack: options.writeBack,
    selections: options.selections,
    maxEntities: 3,
    entities: [],
    schemaMap: {},
    dialect: "snowflake",
    attempts: 0,
    docs: [],
    files: [],
    taggedUrns: [],
    describedUrns: [],
    writeBackErrors: [],
  };

  // A handler may emit on behalf of another stage — the validate loop re-fires
  // generate — so events are attributed by the kind they name.
  const nodeIdByKind = new Map<StageKind, string>();
  for (const node of graph.nodes) {
    if (!nodeIdByKind.has(node.kind)) nodeIdByKind.set(node.kind, node.id);
  }

  let seq = 0;
  const emitRaw = (
    event: Omit<TraceEvent, "id" | "ts">,
    fallbackNodeId: string,
  ) => {
    onEvent({
      ...event,
      nodeId:
        event.nodeId ??
        nodeIdByKind.get(event.node as StageKind) ??
        fallbackNodeId,
      id: `ev_${++seq}`,
      ts: Date.now(),
    });
  };

  let previousLane: Lane | null = null;

  for (const node of order) {
    const handler = STAGE_HANDLERS[node.kind];
    if (!handler) continue;

    const lane = STAGE_BY_KIND[node.kind].lane;
    if (previousLane && lane !== previousLane) {
      // The hand-off is the point of the whole design; say what is carried.
      const carried =
        lane === "codegen"
          ? `${state.entities.length} entities, ${Object.keys(state.schemaMap).length} schemas, dialect=${state.dialect}`
          : state.modelName
            ? `validated model "${state.modelName}" (${state.attempts} attempt${state.attempts > 1 ? "s" : ""})`
            : `${state.docs.length} description(s)`;
      emitRaw(
        {
          lane: previousLane,
          node: "handoff",
          type: "handoff",
          label: `Baton → ${LANE_LABEL[lane]}: ${carried}`,
        },
        node.id,
      );
    }
    previousLane = lane;

    const emit: TraceEmitter = (event) => emitRaw(event, node.id);
    await handler({ state, emit });
  }

  emitRaw(
    {
      lane: "publisher",
      node: "handoff",
      type: "pipeline_complete",
      // Not every pipeline makes files — a documentation run's deliverable is
      // the catalog itself. Report what this graph actually produced.
      label: `Done: ${
        [
          state.files.length && `${state.files.length} file${state.files.length === 1 ? "" : "s"} ready`,
          state.describedUrns.length && `${state.describedUrns.length} dataset(s) described`,
          state.taggedUrns.length && `${state.taggedUrns.length} dataset(s) tagged`,
        ]
          .filter(Boolean)
          .join(", ") || "nothing produced — the pipeline had no output stage"
      }`,
    },
    order[order.length - 1]?.id ?? "",
  );

  return {
    files: state.files,
    writeBack: {
      enabled: state.writeBack,
      taggedUrns: state.taggedUrns,
      errors: state.writeBackErrors,
    },
  };
}
