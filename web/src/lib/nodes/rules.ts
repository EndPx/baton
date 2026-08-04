/**
 * Graph rules.
 *
 * Baton's whole claim is that generated code is grounded in real metadata, so
 * the canvas refuses to express a pipeline that would break that claim: you
 * cannot wire a generate stage that has no schema upstream, you cannot package
 * SQL that was never validated, and you cannot run a graph that violates these.
 *
 * Structural rules are enforced while dragging (the connection is refused).
 * Semantic rules are reported as issues and block the Run button.
 */

import { STAGE_BY_KIND, type Lane, type StageKind } from "@/lib/nodes/registry";

const LANE_ORDER: Record<Lane, number> = {
  context: 0,
  codegen: 1,
  publisher: 2,
};

export interface GraphNodeLike {
  id: string;
  kind: StageKind;
}

export interface GraphEdgeLike {
  source: string;
  target: string;
}

export interface Issue {
  level: "error" | "warning";
  /** Node the issue is attached to, when it is about one stage. */
  nodeId?: string;
  message: string;
}

/** All nodes reachable by walking edges backwards from `nodeId`. */
export function ancestorsOf(
  nodeId: string,
  edges: GraphEdgeLike[],
): Set<string> {
  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    const list = parents.get(edge.target);
    if (list) list.push(edge.source);
    else parents.set(edge.target, [edge.source]);
  }

  const seen = new Set<string>();
  const stack = [...(parents.get(nodeId) ?? [])];
  while (stack.length) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(parents.get(current) ?? []));
  }
  return seen;
}

function hasUpstreamKind(
  nodeId: string,
  kinds: StageKind[],
  nodes: GraphNodeLike[],
  edges: GraphEdgeLike[],
): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const ancestorId of ancestorsOf(nodeId, edges)) {
    const kind = byId.get(ancestorId)?.kind;
    if (kind && kinds.includes(kind)) return true;
  }
  return false;
}

function hasDownstreamKind(
  nodeId: string,
  kinds: StageKind[],
  nodes: GraphNodeLike[],
  edges: GraphEdgeLike[],
): boolean {
  return nodes.some(
    (n) => kinds.includes(n.kind) && ancestorsOf(n.id, edges).has(nodeId),
  );
}

/**
 * Structural check applied while the user drags a connection. Returning a
 * reason lets the UI explain the refusal instead of silently snapping back.
 */
export function canConnect(
  sourceId: string,
  targetId: string,
  nodes: GraphNodeLike[],
  edges: GraphEdgeLike[],
): { ok: boolean; reason?: string } {
  if (sourceId === targetId) {
    return { ok: false, reason: "A stage cannot feed itself." };
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const source = byId.get(sourceId);
  const target = byId.get(targetId);
  if (!source || !target) return { ok: false, reason: "Unknown stage." };

  if (edges.some((e) => e.source === sourceId && e.target === targetId)) {
    return { ok: false, reason: "These stages are already connected." };
  }

  // Cycle: the source already depends on the target.
  if (ancestorsOf(sourceId, edges).has(targetId)) {
    return {
      ok: false,
      reason:
        "That would create a loop — the pipeline runs once, front to back.",
    };
  }

  const sourceLane = STAGE_BY_KIND[source.kind].lane;
  const targetLane = STAGE_BY_KIND[target.kind].lane;
  if (LANE_ORDER[targetLane] < LANE_ORDER[sourceLane]) {
    return {
      ok: false,
      reason: `The baton only moves forward: a ${sourceLane} stage cannot feed a ${targetLane} stage.`,
    };
  }

  return { ok: true };
}

/**
 * Semantic rules over the whole graph. Errors block running; warnings are
 * advice the user can ignore.
 */
export function validateGraph(
  nodes: GraphNodeLike[],
  edges: GraphEdgeLike[],
): Issue[] {
  const issues: Issue[] = [];

  if (nodes.length === 0) {
    return [
      {
        level: "error",
        message: "The canvas is empty — drag in a stage or pick a template.",
      },
    ];
  }

  const label = (kind: StageKind) => STAGE_BY_KIND[kind].label;

  if (!nodes.some((n) => n.kind === "search_entities")) {
    issues.push({
      level: "error",
      message:
        "No Resolve entities stage: nothing can run until the tables in the goal are resolved to DataHub URNs.",
    });
  }

  for (const node of nodes) {
    const { kind, id } = node;

    // Everything except the entry stage needs resolved URNs upstream.
    if (
      kind !== "search_entities" &&
      !hasUpstreamKind(id, ["search_entities"], nodes, edges)
    ) {
      issues.push({
        level: "error",
        nodeId: id,
        message: `${label(kind)} has no Resolve entities upstream, so it has no datasets to work on.`,
      });
    }

    // The grounding rule — the reason this project exists.
    if (
      (kind === "generate_sql" || kind === "generate_docs") &&
      !hasUpstreamKind(id, ["fetch_schema"], nodes, edges)
    ) {
      issues.push({
        level: "error",
        nodeId: id,
        message: `${label(kind)} is not grounded: add Fetch schema upstream, or the model is guessing at columns.`,
      });
    }

    if (
      kind === "validate_sql" &&
      !hasUpstreamKind(id, ["generate_sql"], nodes, edges)
    ) {
      issues.push({
        level: "error",
        nodeId: id,
        message:
          "Validate & self-correct has no Generate SQL upstream to check.",
      });
    }

    if (
      kind === "package_dbt" &&
      !hasUpstreamKind(id, ["validate_sql"], nodes, edges)
    ) {
      issues.push({
        level: "error",
        nodeId: id,
        message:
          "Package dbt files would ship unvalidated SQL — put Validate & self-correct upstream.",
      });
    }

    if (
      kind === "write_back_description" &&
      !hasUpstreamKind(id, ["generate_docs"], nodes, edges)
    ) {
      issues.push({
        level: "error",
        nodeId: id,
        message:
          "Write descriptions has nothing to publish — add Generate descriptions upstream.",
      });
    }

    if (
      kind === "write_back_tags" &&
      !hasUpstreamKind(
        id,
        ["generate_sql", "generate_docs", "package_dbt"],
        nodes,
        edges,
      )
    ) {
      issues.push({
        level: "warning",
        nodeId: id,
        message:
          "Tag sources will record provenance for a run that produced nothing.",
      });
    }

    if (
      kind === "generate_sql" &&
      !hasDownstreamKind(id, ["validate_sql"], nodes, edges)
    ) {
      issues.push({
        level: "warning",
        nodeId: id,
        message:
          "Generate SQL has no Validate stage downstream — the output will not be checked against the schema.",
      });
    }
  }

  return issues;
}

export function blockingIssues(issues: Issue[]): Issue[] {
  return issues.filter((i) => i.level === "error");
}
