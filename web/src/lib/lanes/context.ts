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
  ChoiceRequest,
  EntityCandidate,
  ResolvedEntity,
  SchemaMap,
  TraceEmitter,
} from "@/lib/baton";

/** How many search hits we are willing to show the user at once. */
const MAX_CANDIDATES = 8;

/**
 * Thrown instead of guessing when the search is ambiguous. The route turns
 * this into an SSE `choice` event rather than an error.
 */
export class AmbiguousEntitiesError extends Error {
  constructor(readonly request: ChoiceRequest) {
    super("Awaiting entity selection");
    this.name = "AmbiguousEntitiesError";
  }
}

export interface ContextLaneOptions {
  maxEntities?: number;
  /** Dataset URNs the user picked when a previous run paused. */
  selections?: string[];
}

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

/**
 * Words that describe the *task* rather than the data. DataHub's index
 * matches dataset names and descriptions, not sentences: searching for
 * "generate a dbt model joining orders and customers" returns nothing, while
 * "orders" returns 67 datasets. So the goal is reduced to its nouns first.
 */
const STOP_WORDS = new Set([
  "generate", "create", "build", "make", "write", "produce", "add", "update",
  "dbt", "model", "models", "sql", "query", "queries", "table", "tables",
  "dataset", "datasets", "column", "columns", "schema", "pipeline",
  "join", "joins", "joining", "joined", "filter", "filtered", "filtering",
  "where", "select", "from", "with", "and", "or", "the", "for", "into",
  "that", "this", "these", "those", "using", "use", "last", "past", "days",
  "day", "months", "month", "years", "year", "week", "weeks", "please",
  "document", "documents", "documented", "undocumented", "description",
  "descriptions", "all", "any", "new", "old", "get", "show", "give",
]);

/** Reduce a natural-language goal to the handful of nouns worth searching. */
export function keywordsFrom(goal: string): string[] {
  const terms = Array.from(
    new Set(
      goal
        .toLowerCase()
        .replace(/[^a-z0-9_\s]/g, " ")
        .split(/\s+/)
        .filter(
          (word) =>
            word.length > 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word),
        ),
    ),
  ).slice(0, 4);
  // If the goal was nothing but task words, fall back to the raw text.
  return terms.length > 0 ? terms : [goal];
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
  options: ContextLaneOptions = {},
): Promise<BatonContext> {
  const maxEntities = options.maxEntities ?? 3;
  // --- Node: resolve_entities ---
  emit({
    lane: "context",
    node: "resolve_entities",
    type: "node_start",
    label: "Resolving entities mentioned in the goal",
  });

  const terms = keywordsFrom(goal);
  emit({
    lane: "context",
    node: "resolve_entities",
    type: "tool_call",
    label: `MCP search(${terms.map((t) => `"${t}"`).join(", ")})`,
    data: { tool: "search", terms },
  });

  // One search per term so every noun in the goal gets a look in, rather than
  // the first one crowding out the rest.
  const perTerm = Math.max(2, Math.ceil(MAX_CANDIDATES / terms.length));
  const byUrn = new Map<string, { urn: string; name?: string; platform?: { name?: string }; description?: string }>();

  for (const term of terms) {
    const res = await callTool<SearchResponse>("search", { query: term });
    let taken = 0;
    for (const result of res.data?.searchResults ?? []) {
      const entity = result.entity;
      if (!entity?.urn || !entity.urn.includes(":dataset:")) continue;
      if (!byUrn.has(entity.urn)) {
        byUrn.set(entity.urn, { ...entity, urn: entity.urn });
      }
      if (++taken >= perTerm) break;
    }
  }

  const found = Array.from(byUrn.values()).slice(0, MAX_CANDIDATES);

  if (found.length === 0) {
    throw new Error("No datasets found in DataHub matching the goal");
  }

  const candidates: EntityCandidate[] = found.map((e) => ({
    urn: e.urn!,
    name: e.name ?? tableNameFromUrn(e.urn!),
    platform: e.platform?.name ?? platformFromUrn(e.urn!),
    description: e.description,
  }));

  let chosen: EntityCandidate[];

  if (options.selections?.length) {
    // Only honour URNs that this very search returned, so a client cannot
    // point the pipeline at something the goal never matched.
    const wanted = new Set(options.selections);
    chosen = candidates.filter((c) => wanted.has(c.urn));
    if (chosen.length === 0) {
      throw new Error(
        "None of the selected datasets are in the current search results — run again to refresh the candidates.",
      );
    }
    emit({
      lane: "context",
      node: "resolve_entities",
      type: "tool_result",
      label: `Using your selection: ${chosen.map((c) => c.name).join(", ")}`,
      data: { entities: chosen },
    });
  } else if (candidates.length > maxEntities) {
    // Refuse to silently truncate: ask instead of picking the first N.
    emit({
      lane: "context",
      node: "resolve_entities",
      type: "tool_result",
      label: `${candidates.length} datasets match — asking which to use instead of guessing`,
      data: { candidates },
    });
    throw new AmbiguousEntitiesError({
      candidates,
      preselected: candidates.slice(0, maxEntities).map((c) => c.urn),
      reason: `Search matched ${candidates.length} datasets. Choose the ones the model should be grounded in.`,
    });
  } else {
    chosen = candidates;
  }

  const entities: ResolvedEntity[] = chosen.map((c) => ({
    urn: c.urn,
    name: c.name,
    platform: c.platform,
    entityType: "DATASET",
    description: c.description,
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
