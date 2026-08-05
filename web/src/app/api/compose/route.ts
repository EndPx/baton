import "server-only";

/**
 * POST /api/compose — turn a natural-language goal into a pipeline graph.
 *
 * The model may only choose stage kinds that exist in the palette (enforced
 * by the tool schema enum and re-checked here), and it never chooses layout:
 * positions are computed from the dependency graph so the canvas stays
 * readable. The Anthropic call happens here, server-side, so the API key is
 * never exposed to the browser.
 */

import { chatJson } from "@/lib/llm";
import { STAGES, type StageKind } from "@/lib/nodes/registry";
import type { GraphEdge, GraphNode, PipelineGraph } from "@/lib/templates";

const KINDS = STAGES.map((s) => s.kind);
const VALID = new Set<string>(KINDS);

const COL = 300;
const ROW = 130;

interface ModelStage {
  id: string;
  kind: string;
  dependsOn: string[];
}

/** Longest-path depth per node, so dependencies always sit to the left. */
function layout(stages: ModelStage[]): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const depthCache = new Map<string, number>();

  const depthOf = (id: string, seen: Set<string>): number => {
    if (depthCache.has(id)) return depthCache.get(id)!;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const stage = byId.get(id);
    const parents = (stage?.dependsOn ?? []).filter((p) => byId.has(p));
    const d = parents.length
      ? Math.max(...parents.map((p) => depthOf(p, seen))) + 1
      : 0;
    depthCache.set(id, d);
    return d;
  };

  const rowCursor = new Map<number, number>();
  const nodes: GraphNode[] = stages.map((stage) => {
    const depth = depthOf(stage.id, new Set());
    const row = rowCursor.get(depth) ?? 0;
    rowCursor.set(depth, row + 1);
    return {
      id: stage.id,
      kind: stage.kind as StageKind,
      position: { x: depth * COL, y: row * ROW },
    };
  });

  const edges: GraphEdge[] = [];
  for (const stage of stages) {
    for (const parent of stage.dependsOn ?? []) {
      if (byId.has(parent)) edges.push({ source: parent, target: stage.id });
    }
  }

  return { nodes, edges };
}

const SYSTEM = `You compose pipelines for Baton, a metadata-grounded code generator for DataHub.

Rules:
- Use ONLY the stage kinds provided in the tool schema. Never invent a stage.
- A pipeline that generates SQL must ground it first: include fetch_schema before generate_sql, and always follow generate_sql with validate_sql.
- Context stages (search_entities, fetch_schema, fetch_lineage, dataset_queries) come first; search_entities is almost always the single root.
- Independent context stages should both depend on search_entities so they run in parallel, then feed the generate stage.
- Only include write-back stages (write_back_tags, write_back_description) when the goal implies publishing something back to the catalog.
- Keep pipelines minimal: 4-7 stages. Do not add stages the goal does not need.
- Stage ids are short strings like "n1", "n2".`;

export async function POST(req: Request) {
  let goal: string;
  try {
    const body = await req.json();
    goal = String(body?.goal ?? "").trim();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!goal) {
    return Response.json({ error: "A goal is required" }, { status: 400 });
  }
  if (!process.env.LLM_API_KEY) {
    return Response.json(
      {
        error:
          "LLM_API_KEY is not configured on the server. Pick a template instead, or set the key to enable AI compose.",
      },
      { status: 503 },
    );
  }

  try {
    const result = await chatJson<{ stages?: ModelStage[] }>({
      system: SYSTEM,
      user: `Goal: ${goal}`,
      schemaName: "pipeline",
      maxTokens: 1500,
      isValid: (value) => Array.isArray(value?.stages),
      schema: {
        type: "object",
        properties: {
          stages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                kind: { type: "string", enum: KINDS },
                dependsOn: {
                  type: "array",
                  items: { type: "string" },
                  description: "Ids of stages that must run before this one",
                },
              },
              required: ["id", "kind", "dependsOn"],
              additionalProperties: false,
            },
          },
        },
        required: ["stages"],
        additionalProperties: false,
      },
    });

    const raw = result.stages ?? [];
    const stages = raw.filter((s) => s?.id && VALID.has(s.kind));
    if (stages.length === 0) {
      return Response.json(
        { error: "The model returned no usable stages" },
        { status: 502 },
      );
    }

    const { nodes, edges } = layout(stages);
    const graph: PipelineGraph = {
      id: "composed",
      name: "Composed pipeline",
      description: `Composed from: ${goal}`,
      sampleGoal: goal,
      nodes,
      edges,
    };
    return Response.json(graph);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return Response.json({ error: detail }, { status: 500 });
  }
}
