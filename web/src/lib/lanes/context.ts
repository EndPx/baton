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
  // what to do
  "generate", "create", "build", "make", "write", "produce", "add", "update",
  "rename", "migrate", "migration", "backfill", "refactor", "deprecate",
  "replace", "fix", "change", "modify", "move", "copy", "drop", "delete",
  "document", "documents", "documented", "undocumented", "describe",
  "description", "descriptions", "get", "show", "give", "find", "list",
  // what to make
  "dbt", "model", "models", "sql", "query", "queries", "table", "tables",
  "dataset", "datasets", "column", "columns", "field", "fields", "schema",
  "pipeline", "report", "file", "files",
  // grammar
  "join", "joins", "joining", "joined", "filter", "filtered", "filtering",
  "where", "select", "from", "with", "and", "or", "the", "for", "into",
  "that", "this", "these", "those", "using", "use", "all", "any", "new",
  "old", "everything", "please", "downstream", "upstream", "its", "their",
  "last", "past", "days", "day", "months", "month", "years", "year",
  "week", "weeks", "recent",
]);

/** Words that introduce the thing being acted on: "…on fact_orders". */
const OBJECT_MARKERS = new Set(["on", "from", "in", "of", "to", "against", "for"]);

/**
 * Reduce a natural-language goal to the handful of terms worth searching, best
 * first.
 *
 * Ranking matters more than filtering. "rename order_total to gross_amount on
 * fact_orders" has four survivable words, but only `fact_orders` names a
 * dataset — the others are column names and a verb. Taking them in written
 * order spends the search budget on terms that match nothing and starves the
 * one that would have worked.
 */
export function keywordsFrom(goal: string): string[] {
  const words = goal
    .toLowerCase()
    .replace(/[^a-z0-9_.\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const scored = new Map<string, number>();

  words.forEach((word, index) => {
    if (word.length <= 2 || STOP_WORDS.has(word) || /^\d+$/.test(word)) return;

    let score = 1;
    // Underscores and dots are how warehouses spell names.
    if (word.includes("_") || word.includes(".")) score += 3;
    // "on fact_orders", "from raw_events" — the object of the sentence.
    if (index > 0 && OBJECT_MARKERS.has(words[index - 1])) score += 2;
    // Later mentions tend to be the target, earlier ones the verb's leftovers.
    score += index / words.length;

    scored.set(word, Math.max(scored.get(word) ?? 0, score));
  });

  const ranked = [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .slice(0, 4);

  // If the goal was nothing but task words, fall back to the raw text.
  return ranked.length > 0 ? ranked : [goal];
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

  // One search per term, but the budget is not split evenly: the best-ranked
  // term is the likeliest dataset name, so it gets the most slots and its
  // hits land first (insertion order survives the dedupe below).
  const byUrn = new Map<
    string,
    { urn: string; name?: string; platform?: { name?: string }; description?: string }
  >();

  for (const [rank, term] of terms.entries()) {
    const perTerm = rank === 0 ? 4 : 2;
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
    // The tool's parameter is `urn`, not `dataset_urn` — verified against the
    // live sidecar's tools/list contract.
    const schema = await callTool<SchemaFieldsResponse>("list_schema_fields", {
      urn: entity.urn,
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
  // Grounding is the product. Continuing with an empty schema map would hand
  // the model a blank slate and call the result "grounded".
  const totalColumns = Object.values(schemaMap).reduce(
    (sum, cols) => sum + Object.keys(cols).length,
    0,
  );
  if (totalColumns === 0) {
    throw new Error(
      `No schema metadata found for ${entities.map((e) => e.name).join(", ")} — nothing to ground the generated SQL against.`,
    );
  }

  emit({
    lane: "context",
    node: "fetch_schema",
    type: "node_complete",
    label: `Schemas fetched — ${totalColumns} columns across ${Object.keys(schemaMap).length} table(s)`,
  });

  // --- Node: fetch_lineage (best-effort) ---
  let lineage: unknown;
  if (entities.length < 2) {
    // Say so out loud. A stage that silently stays dark reads as broken.
    emit({
      lane: "context",
      node: "fetch_lineage",
      type: "node_skipped",
      label: `Skipped — lineage runs between two datasets, and this run resolved only ${entities[0].name}`,
    });
  } else {
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
      const res = await callTool(
        "get_lineage_paths_between",
        { source_urn: entities[0].urn, target_urn: entities[1].urn },
        { tolerateError: true }, // no path between two tables is normal
      );
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
