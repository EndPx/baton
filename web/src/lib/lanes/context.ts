/**
 * Context lane — resolves what the user is talking about and pulls
 * grounding data from DataHub via the MCP sidecar.
 *
 * Nodes: resolve_entities → fetch_schema → fetch_lineage
 * Hands off a BatonContext to the Codegen lane.
 */

import { callTool } from "@/lib/mcp";
import type {
  BatonContext,
  ResolvedEntity,
  SchemaMap,
  TraceEmitter,
} from "@/lib/baton";

interface SearchResponse {
  searchResults?: Array<{
    entity?: {
      urn?: string;
      type?: string;
      name?: string;
      platform?: { name?: string };
      description?: string;
    };
  }>;
  total?: number;
}

interface SchemaFieldsResponse {
  fields?: Array<{ fieldPath?: string; nativeDataType?: string; type?: string }>;
  schema_fields?: Array<{ fieldPath?: string; nativeDataType?: string; type?: string }>;
}

function platformFromUrn(urn: string): string {
  // urn:li:dataset:(urn:li:dataPlatform:snowflake,db.schema.table,PROD)
  const m = urn.match(/dataPlatform:([a-zA-Z0-9_-]+)/);
  return m ? m[1] : "unknown";
}

function tableNameFromUrn(urn: string): string {
  const m = urn.match(/dataPlatform:[a-zA-Z0-9_-]+,([^,)]+)/);
  const full = m ? m[1] : urn;
  const parts = full.split(".");
  return parts[parts.length - 1];
}

/** Map a DataHub platform to a sqlglot dialect name. */
function dialectForPlatform(platform: string): string {
  const map: Record<string, string> = {
    snowflake: "snowflake",
    dbt: "snowflake", // showcase-ecommerce dbt models compile to Snowflake
    postgres: "postgres",
    bigquery: "bigquery",
    mysql: "mysql",
    spark: "spark",
  };
  return map[platform] ?? "snowflake";
}

export async function runContextLane(
  goal: string,
  emit: TraceEmitter,
  maxEntities = 3,
): Promise<BatonContext> {
  // --- Node: resolve_entities ---
  emit({
    lane: "context",
    node: "resolve_entities",
    type: "node_start",
    label: "Resolving entities mentioned in the goal",
  });

  emit({
    lane: "context",
    node: "resolve_entities",
    type: "tool_call",
    label: `MCP search("${goal.slice(0, 60)}…")`,
    data: { tool: "search", query: goal },
  });

  const search = await callTool<SearchResponse>("search", { query: goal });
  const candidates = (search.data?.searchResults ?? [])
    .map((r) => r.entity)
    .filter(
      (e): e is NonNullable<typeof e> =>
        !!e?.urn && e.urn.includes(":dataset:"),
    )
    .slice(0, maxEntities);

  if (candidates.length === 0) {
    throw new Error("No datasets found in DataHub matching the goal");
  }

  const entities: ResolvedEntity[] = candidates.map((e) => ({
    urn: e.urn!,
    name: e.name ?? tableNameFromUrn(e.urn!),
    platform: e.platform?.name ?? platformFromUrn(e.urn!),
    entityType: e.type ?? "DATASET",
    description: e.description,
  }));

  emit({
    lane: "context",
    node: "resolve_entities",
    type: "tool_result",
    label: `Resolved ${entities.length} dataset(s): ${entities.map((e) => e.name).join(", ")}`,
    data: { entities },
  });
  emit({
    lane: "context",
    node: "resolve_entities",
    type: "node_complete",
    label: "Entities resolved",
  });

  // --- Node: fetch_schema ---
  emit({
    lane: "context",
    node: "fetch_schema",
    type: "node_start",
    label: "Fetching real schemas from DataHub",
  });

  const schemaMap: SchemaMap = {};
  for (const entity of entities) {
    emit({
      lane: "context",
      node: "fetch_schema",
      type: "tool_call",
      label: `MCP list_schema_fields(${entity.name})`,
      data: { tool: "list_schema_fields", urn: entity.urn },
    });
    const schema = await callTool<SchemaFieldsResponse>("list_schema_fields", {
      dataset_urn: entity.urn,
    });
    const fields = schema.data?.fields ?? schema.data?.schema_fields ?? [];
    const tableName = tableNameFromUrn(entity.urn);
    schemaMap[tableName] = {};
    for (const f of fields) {
      if (f.fieldPath) {
        schemaMap[tableName][f.fieldPath] =
          f.nativeDataType ?? f.type ?? "unknown";
      }
    }
    emit({
      lane: "context",
      node: "fetch_schema",
      type: "tool_result",
      label: `${tableName}: ${Object.keys(schemaMap[tableName]).length} columns`,
      data: { table: tableName, columns: schemaMap[tableName] },
    });
  }
  emit({
    lane: "context",
    node: "fetch_schema",
    type: "node_complete",
    label: "Schemas fetched",
  });

  // --- Node: fetch_lineage (best-effort) ---
  let lineage: unknown;
  if (entities.length >= 2) {
    emit({
      lane: "context",
      node: "fetch_lineage",
      type: "node_start",
      label: "Tracing lineage between resolved datasets",
    });
    emit({
      lane: "context",
      node: "fetch_lineage",
      type: "tool_call",
      label: `MCP get_lineage_paths_between(${entities[0].name} → ${entities[1].name})`,
      data: { tool: "get_lineage_paths_between" },
    });
    try {
      const res = await callTool("get_lineage_paths_between", {
        source_urn: entities[0].urn,
        target_urn: entities[1].urn,
      });
      lineage = res.data ?? res.raw;
      emit({
        lane: "context",
        node: "fetch_lineage",
        type: "tool_result",
        label: "Lineage paths retrieved",
        data: { lineage },
      });
    } catch {
      emit({
        lane: "context",
        node: "fetch_lineage",
        type: "tool_result",
        label: "No lineage path found (non-blocking)",
      });
    }
    emit({
      lane: "context",
      node: "fetch_lineage",
      type: "node_complete",
      label: "Lineage step done",
    });
  }

  const dialect = dialectForPlatform(entities[0].platform);

  emit({
    lane: "context",
    node: "handoff",
    type: "handoff",
    label: `Baton → Codegen: ${entities.length} entities, ${Object.keys(schemaMap).length} schemas, dialect=${dialect}`,
  });

  return { goal, entities, schemaMap, lineage, dialect };
}
