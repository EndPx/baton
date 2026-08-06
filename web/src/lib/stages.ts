import "server-only";

/**
 * One handler per stage on the canvas.
 *
 * Each handler reads what earlier stages left in RunState and adds its own
 * result, so the graph decides what runs and in what order — not this file.
 * Handlers emit with `node` set to their StageKind; the executor turns that
 * into the id of the node you actually placed, so the right box lights up.
 */

import { callTool } from "@/lib/mcp";
import { ensureTag } from "@/lib/datahub";
import { chatJson, LLM_MODEL } from "@/lib/llm";
import type { StageKind } from "@/lib/nodes/registry";
import type {
  ChoiceRequest,
  EntityCandidate,
  GeneratedFile,
  ResolvedEntity,
  SchemaMap,
  TraceEmitter,
  ValidationReport,
} from "@/lib/baton";

const MAX_CANDIDATES = 8;
const MAX_CORRECTIONS = 2;
/** Historical SQL is only a style hint, so a couple of datasets is enough. */
const QUERY_SAMPLE_LIMIT = 2;
const BATON_TAG = "generated-by-baton";
const VALIDATOR_URL = process.env.VALIDATOR_URL ?? "http://localhost:8100";

export class AmbiguousEntitiesError extends Error {
  constructor(readonly request: ChoiceRequest) {
    super("Awaiting entity selection");
    this.name = "AmbiguousEntitiesError";
  }
}

export interface RunState {
  goal: string;
  writeBack: boolean;
  selections?: string[];
  maxEntities: number;

  entities: ResolvedEntity[];
  schemaMap: SchemaMap;
  lineage?: unknown;
  queries?: unknown;
  dialect: string;

  sql?: string;
  modelName?: string;
  notes?: string;
  validation?: ValidationReport;
  attempts: number;

  /**
   * One record per selected dataset. `schemaMap` is keyed by the bare table
   * name because the SQL validator resolves columns against the identifiers
   * written in the SQL, so two catalogs' `customers` collapse into one entry
   * there. This keeps every selected dataset distinct.
   */
  schemas: Array<{
    urn: string;
    label: string;
    table: string;
    columns: Record<string, string>;
  }>;

  /** `name` is the run-unique label, not the bare table name. */
  docs: Array<{ urn: string; name: string; description: string }>;

  files: GeneratedFile[];
  taggedUrns: string[];
  describedUrns: string[];
  writeBackErrors: string[];
}

export interface StageContext {
  state: RunState;
  emit: TraceEmitter;
}

export type StageHandler = (ctx: StageContext) => Promise<void>;

/* ── shared helpers ──────────────────────────────────────────────────── */

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
}

interface SchemaFieldsResponse {
  fields?: Array<{ fieldPath?: string; nativeDataType?: string; type?: string }>;
  schema_fields?: Array<{
    fieldPath?: string;
    nativeDataType?: string;
    type?: string;
  }>;
}

export function platformFromUrn(urn: string): string {
  return urn.match(/dataPlatform:([a-zA-Z0-9_-]+)/)?.[1] ?? "unknown";
}

export function tableNameFromUrn(urn: string): string {
  const full = urn.match(/dataPlatform:[a-zA-Z0-9_-]+,([^,)]+)/)?.[1] ?? urn;
  return full.split(".").pop() ?? full;
}

function pathFromUrn(urn: string): string {
  return urn.match(/dataPlatform:[a-zA-Z0-9_-]+,([^,)]+)/)?.[1] ?? urn;
}

/**
 * A label that is unique across the datasets in this run. Two platforms can
 * both hold a table called `customers`, and identifying a dataset by the bare
 * name silently merges them — which is how one selected dataset went
 * undocumented while another was described twice. Qualify only as far as it
 * takes to separate them.
 */
export function labelForUrn(urn: string, all: string[]): string {
  const table = tableNameFromUrn(urn);
  if (all.filter((u) => tableNameFromUrn(u) === table).length <= 1) return table;

  const qualified = `${table} · ${platformFromUrn(urn)}`;
  const sameQualified = all.filter(
    (u) => `${tableNameFromUrn(u)} · ${platformFromUrn(u)}` === qualified,
  );
  if (sameQualified.length <= 1) return qualified;

  return `${qualified} · ${pathFromUrn(urn)}`;
}

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

const STOP_WORDS = new Set([
  "generate", "create", "build", "make", "write", "produce", "add", "update",
  "rename", "migrate", "migration", "backfill", "refactor", "deprecate",
  "replace", "fix", "change", "modify", "move", "copy", "drop", "delete",
  "document", "documents", "documented", "undocumented", "describe",
  "description", "descriptions", "get", "show", "give", "find", "list",
  "dbt", "model", "models", "sql", "query", "queries", "table", "tables",
  "dataset", "datasets", "column", "columns", "field", "fields", "schema",
  "pipeline", "report", "file", "files",
  "join", "joins", "joining", "joined", "filter", "filtered", "filtering",
  "where", "select", "from", "with", "and", "or", "the", "for", "into",
  "that", "this", "these", "those", "using", "use", "all", "any", "new",
  "old", "everything", "please", "downstream", "upstream", "its", "their",
  "last", "past", "days", "day", "months", "month", "years", "year",
  "week", "weeks", "recent",
]);

const OBJECT_MARKERS = new Set([
  "on", "from", "in", "of", "to", "against", "for",
]);

/**
 * Reduce a goal to the terms worth searching, best first. Ranking matters
 * more than filtering: "rename order_total to gross_amount on fact_orders"
 * leaves four words, but only fact_orders names a dataset.
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
    if (word.includes("_") || word.includes(".")) score += 3;
    if (index > 0 && OBJECT_MARKERS.has(words[index - 1])) score += 2;
    score += index / words.length;
    scored.set(word, Math.max(scored.get(word) ?? 0, score));
  });

  const ranked = [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .slice(0, 4);
  return ranked.length > 0 ? ranked : [goal];
}

function schemaLines(schemaMap: SchemaMap): string {
  return Object.entries(schemaMap)
    .map(
      ([table, cols]) =>
        `- ${table}:\n${Object.entries(cols)
          .map(([c, t]) => `    - ${c} (${t})`)
          .join("\n")}`,
    )
    .join("\n");
}

async function postValidator(
  sql: string,
  state: RunState,
): Promise<ValidationReport> {
  const res = await fetch(`${VALIDATOR_URL}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sql,
      schema_map: state.schemaMap,
      dialect: state.dialect,
    }),
  });
  if (!res.ok) throw new Error(`Validator service error: HTTP ${res.status}`);
  const body = (await res.json()) as {
    valid: boolean;
    stage: "jinja" | "parse" | "shape" | "qualify" | null;
    errors: string[];
    columns_used: string[];
    tables_used: string[];
    output_columns?: string[];
  };
  return {
    valid: body.valid,
    stage: body.stage,
    errors: body.errors,
    columnsUsed: body.columns_used,
    outputColumns: body.output_columns ?? [],
    tablesUsed: body.tables_used,
  };
}

const SQL_SCHEMA = {
  type: "object",
  properties: {
    sql: { type: "string" },
    model_name: { type: "string" },
    notes: { type: "string" },
  },
  required: ["sql", "model_name", "notes"],
  additionalProperties: false,
} as const;

interface SqlOutput {
  sql: string;
  model_name: string;
  notes: string;
}

/** One generation turn. Shared by the generate stage and its retries. */
async function generateSql(
  state: RunState,
  emit: TraceEmitter,
  attempt: number,
  lastErrors: string[],
): Promise<SqlOutput> {
  emit({
    lane: "codegen",
    node: "generate_sql",
    type: "node_start",
    label:
      attempt === 0
        ? "Generating dbt SQL grounded in the fetched schema"
        : `Correction attempt ${attempt}: fixing ${lastErrors[0] ?? "validation error"}`,
  });
  emit({
    lane: "codegen",
    node: "generate_sql",
    type: "tool_call",
    label: `LLM: ${LLM_MODEL} (structured output)`,
    data: { model: LLM_MODEL, attempt: attempt + 1 },
  });

  const system = `You are Baton's Codegen agent. Generate a single dbt SQL model that fulfils the user's goal.

Hard constraints:
- Only reference the tables and columns listed in the schema map below. Never invent columns.
- Reference source tables with dbt ref() macros: {{ ref('<table_name>') }}.
- {{ ref(...) }} and {{ source(...) }} are the ONLY templating allowed. Never call or invent any other macro — write the logic as plain SQL.
- Use {{ ref('t') }} only where a table belongs. To qualify a column, give the ref an alias and use the alias.
- Select columns explicitly. Never use SELECT *, so the model's output columns are known.
- Target SQL dialect: ${state.dialect}.
- Output must be a complete, runnable SELECT statement (CTEs allowed).
- Format the SQL across multiple lines with standard indentation; it goes into a pull request.

Schema map (the only tables/columns that exist):
${schemaLines(state.schemaMap)}${
    state.queries
      ? `\n\nHistorical SQL against these tables, for house style:\n${JSON.stringify(state.queries).slice(0, 1500)}`
      : ""
  }`;

  const user =
    attempt === 0
      ? `Goal: ${state.goal}`
      : `Goal: ${state.goal}

Your previous SQL failed validation with these errors:
${lastErrors.map((e) => `- ${e}`).join("\n")}

Previous SQL:
${state.sql ?? ""}

Fix the SQL so every referenced column exists in the schema map.`;

  const gen = await chatJson<SqlOutput>({
    system,
    user,
    schemaName: "dbt_model",
    schema: SQL_SCHEMA as unknown as Record<string, unknown>,
    isValid: (v) => Boolean(v?.sql && v?.model_name),
  });

  emit({
    lane: "codegen",
    node: "generate_sql",
    type: "node_complete",
    label: `Generated model "${gen.model_name}" (${gen.sql.length} chars)`,
    data: { sql: gen.sql, notes: gen.notes },
  });
  return gen;
}

/* ── handlers ────────────────────────────────────────────────────────── */

const searchEntities: StageHandler = async ({ state, emit }) => {
  emit({
    lane: "context",
    node: "search_entities",
    type: "node_start",
    label: "Resolving entities mentioned in the goal",
  });

  const terms = keywordsFrom(state.goal);
  emit({
    lane: "context",
    node: "search_entities",
    type: "tool_call",
    label: `MCP search(${terms.map((t) => `"${t}"`).join(", ")})`,
    data: { tool: "search", terms },
  });

  const byUrn = new Map<string, EntityCandidate>();
  const hitsPerTerm = new Map<string, string[]>();

  for (const [rank, term] of terms.entries()) {
    const perTerm = rank === 0 ? 4 : 2;
    const res = await callTool<SearchResponse>("search", { query: term });
    const hits: string[] = [];
    for (const result of res.data?.searchResults ?? []) {
      const entity = result.entity;
      if (!entity?.urn || !entity.urn.includes(":dataset:")) continue;
      if (!byUrn.has(entity.urn)) {
        byUrn.set(entity.urn, {
          urn: entity.urn,
          name: entity.name ?? tableNameFromUrn(entity.urn),
          platform: entity.platform?.name ?? platformFromUrn(entity.urn),
          description: entity.description,
        });
      }
      hits.push(entity.urn);
      if (hits.length >= perTerm) break;
    }
    hitsPerTerm.set(term, hits);
  }

  const candidates = [...byUrn.values()].slice(0, MAX_CANDIDATES);
  const known = new Set(candidates.map((c) => c.urn));

  /**
   * Take one hit from each term before taking a second from any. "orders and
   * customers" otherwise preselects three flavours of customers and never
   * looks at orders, because the higher-ranked term fills the whole budget.
   */
  const spreadPreselection = (limit: number): string[] => {
    const picked: string[] = [];
    for (let round = 0; picked.length < limit && round < MAX_CANDIDATES; round++) {
      for (const term of terms) {
        const urn = (hitsPerTerm.get(term) ?? [])[round];
        if (urn && known.has(urn) && !picked.includes(urn)) {
          picked.push(urn);
          if (picked.length >= limit) break;
        }
      }
    }
    // Fall back to plain order if the terms produced too few between them.
    for (const candidate of candidates) {
      if (picked.length >= limit) break;
      if (!picked.includes(candidate.urn)) picked.push(candidate.urn);
    }
    return picked;
  };
  if (candidates.length === 0) {
    throw new Error("No datasets found in DataHub matching the goal");
  }

  let chosen: EntityCandidate[];
  if (state.selections?.length) {
    const wanted = new Set(state.selections);
    chosen = candidates.filter((c) => wanted.has(c.urn));
    if (chosen.length === 0) {
      throw new Error(
        "None of the selected datasets are in the current search results — run again to refresh the candidates.",
      );
    }
    emit({
      lane: "context",
      node: "search_entities",
      type: "tool_result",
      label: `Using your selection: ${chosen.map((c) => c.name).join(", ")}`,
    });
  } else if (candidates.length > state.maxEntities) {
    emit({
      lane: "context",
      node: "search_entities",
      type: "tool_result",
      label: `${candidates.length} datasets match — asking which to use instead of guessing`,
      data: { candidates },
    });
    throw new AmbiguousEntitiesError({
      candidates,
      preselected: spreadPreselection(state.maxEntities),
      reason: `Search matched ${candidates.length} datasets. Choose the ones the model should be grounded in.`,
    });
  } else {
    chosen = candidates;
  }

  state.entities = chosen.map((c) => ({
    urn: c.urn,
    name: c.name,
    platform: c.platform,
    entityType: "DATASET",
    description: c.description,
  }));
  // Search order is arbitrary, so take the dialect the selection agrees on
  // rather than whichever dataset happened to come back first.
  const dialectVotes = new Map<string, number>();
  for (const e of state.entities) {
    const d = dialectForPlatform(e.platform);
    dialectVotes.set(d, (dialectVotes.get(d) ?? 0) + 1);
  }
  state.dialect = [...dialectVotes.entries()].sort((a, b) => b[1] - a[1])[0][0];

  emit({
    lane: "context",
    node: "search_entities",
    type: "node_complete",
    // Qualify the names, so "customers, customers, orders" says which is which.
    label: `Resolved ${state.entities.length} dataset(s): ${state.entities
      .map((e) =>
        labelForUrn(
          e.urn,
          state.entities.map((x) => x.urn),
        ),
      )
      .join(", ")}`,
    data: { entities: state.entities },
  });
};

const fetchSchema: StageHandler = async ({ state, emit }) => {
  emit({
    lane: "context",
    node: "fetch_schema",
    type: "node_start",
    label: "Fetching real schemas from DataHub",
  });

  const urns = state.entities.map((e) => e.urn);

  for (const entity of state.entities) {
    const label = labelForUrn(entity.urn, urns);
    emit({
      lane: "context",
      node: "fetch_schema",
      type: "tool_call",
      label: `MCP list_schema_fields(${label})`,
    });
    // The tool's parameter is `urn`, not `dataset_urn`.
    const schema = await callTool<SchemaFieldsResponse>("list_schema_fields", {
      urn: entity.urn,
    });
    const fields = schema.data?.fields ?? schema.data?.schema_fields ?? [];
    const table = tableNameFromUrn(entity.urn);

    const columns: Record<string, string> = {};
    for (const f of fields) {
      if (f.fieldPath) {
        columns[f.fieldPath] = f.nativeDataType ?? f.type ?? "unknown";
      }
    }
    state.schemas.push({ urn: entity.urn, label, table, columns });

    // schemaMap keeps the bare table name as its key, because that is the
    // identifier the generated SQL uses and the validator resolves against.
    // Two selected datasets can therefore land on one key — merge them and say
    // so, rather than letting the later one silently replace the earlier.
    const collision = state.schemaMap[table] !== undefined;
    state.schemaMap[table] = { ...(state.schemaMap[table] ?? {}), ...columns };

    emit({
      lane: "context",
      node: "fetch_schema",
      type: "tool_result",
      label: collision
        ? `${label}: ${Object.keys(columns).length} columns — shares the table name "${table}" with another selected dataset, so SQL grounding merges them`
        : `${label}: ${Object.keys(columns).length} columns`,
    });
  }

  const total = Object.values(state.schemaMap).reduce(
    (sum, cols) => sum + Object.keys(cols).length,
    0,
  );
  if (total === 0) {
    throw new Error(
      `No schema metadata found for ${state.entities.map((e) => e.name).join(", ")} — nothing to ground the generated SQL against.`,
    );
  }

  emit({
    lane: "context",
    node: "fetch_schema",
    type: "node_complete",
    label: `Schemas fetched — ${total} columns across ${state.schemas.length} dataset(s)`,
  });
};

const fetchLineage: StageHandler = async ({ state, emit }) => {
  if (state.entities.length < 2) {
    emit({
      lane: "context",
      node: "fetch_lineage",
      type: "node_skipped",
      label: `Skipped — lineage runs between two datasets, and this run resolved only ${state.entities[0]?.name ?? "one"}`,
    });
    return;
  }

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
    label: `MCP get_lineage_paths_between(${state.entities
      .slice(0, 2)
      .map((e) =>
        labelForUrn(
          e.urn,
          state.entities.map((x) => x.urn),
        ),
      )
      .join(" → ")})`,
  });

  try {
    const res = await callTool(
      "get_lineage_paths_between",
      {
        source_urn: state.entities[0].urn,
        target_urn: state.entities[1].urn,
      },
      { tolerateError: true }, // no path between two tables is normal
    );
    state.lineage = res.data ?? res.raw;
    emit({
      lane: "context",
      node: "fetch_lineage",
      type: "tool_result",
      label: "Lineage paths retrieved",
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
};

const datasetQueries: StageHandler = async ({ state, emit }) => {
  emit({
    lane: "context",
    node: "dataset_queries",
    type: "node_start",
    label: "Reading historical SQL written against these tables",
  });

  const urns = state.entities.map((e) => e.urn);
  const sampled = state.entities.slice(0, QUERY_SAMPLE_LIMIT);
  const skipped = state.entities.length - sampled.length;

  const collected: unknown[] = [];
  for (const entity of sampled) {
    emit({
      lane: "context",
      node: "dataset_queries",
      type: "tool_call",
      label: `MCP get_dataset_queries(${labelForUrn(entity.urn, urns)})`,
    });
    const res = await callTool(
      "get_dataset_queries",
      { urn: entity.urn },
      { tolerateError: true }, // plenty of datasets have no recorded queries
    );
    if (!res.isError && res.data) collected.push(res.data);
  }

  state.queries = collected.length > 0 ? collected : undefined;
  emit({
    lane: "context",
    node: "dataset_queries",
    type: "node_complete",
    // Say when the cap left datasets unread, rather than reporting the sample
    // as if it were the whole selection.
    label: collected.length
      ? `Collected sample queries for ${collected.length} dataset(s)${
          skipped > 0
            ? ` — sampled the first ${QUERY_SAMPLE_LIMIT} of ${state.entities.length}`
            : ""
        }`
      : "No recorded queries for these datasets (non-blocking)",
  });
};

const generateSqlStage: StageHandler = async ({ state, emit }) => {
  const gen = await generateSql(state, emit, 0, []);
  state.sql = gen.sql;
  state.modelName = gen.model_name;
  state.notes = gen.notes;
  state.attempts = 1;
};

const DOCS_SCHEMA = {
  type: "object",
  properties: {
    datasets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
        },
        required: ["name", "description"],
        additionalProperties: false,
      },
    },
  },
  required: ["datasets"],
  additionalProperties: false,
} as const;

const generateDocs: StageHandler = async ({ state, emit }) => {
  emit({
    lane: "codegen",
    node: "generate_docs",
    type: "node_start",
    label: "Drafting descriptions from schema and lineage",
  });
  emit({
    lane: "codegen",
    node: "generate_docs",
    type: "tool_call",
    label: `LLM: ${LLM_MODEL} (structured output)`,
  });

  // Address each dataset by its run-unique label. Asking the model to describe
  // "customers, customers, orders" gave it no way to tell two catalogs apart,
  // and gave us no way to bind its answers back to the right URNs.
  const urns = state.entities.map((e) => e.urn);
  const targets =
    state.schemas.length > 0
      ? state.schemas.map((s) => ({
          urn: s.urn,
          label: s.label,
          columns: Object.keys(s.columns),
        }))
      : state.entities.map((e) => ({
          urn: e.urn,
          label: labelForUrn(e.urn, urns),
          columns: [] as string[],
        }));

  const result = await chatJson<{
    datasets: Array<{ name: string; description: string }>;
  }>({
    system: `You are Baton's documentation agent. Write one clear, factual sentence describing each dataset, based only on the columns listed for that dataset. Never invent columns or business meaning you cannot see. Datasets may share a table name across platforms; treat them as separate datasets.

Datasets and their columns:
${targets.map((t) => `${t.label}: ${t.columns.join(", ") || "(no columns reported)"}`).join("\n")}`,
    user: `Goal: ${state.goal}\n\nDescribe each dataset below. Return "name" exactly as written here:\n${targets.map((t) => `- ${t.label}`).join("\n")}`,
    schemaName: "dataset_docs",
    schema: DOCS_SCHEMA as unknown as Record<string, unknown>,
    isValid: (v) => Array.isArray(v?.datasets),
    maxTokens: 2000,
  });

  // Each dataset may be claimed once. Two drafts naming "customers" must not
  // both land on the same URN, leaving the other dataset undescribed.
  const taken = new Set<string>();
  const claim = (name: string) => {
    const key = name.trim().toLowerCase();
    const free = targets.filter((t) => !taken.has(t.urn));
    return (
      free.find((t) => t.label.toLowerCase() === key) ??
      // The model sometimes echoes the bare table name; accept it, but only
      // for a dataset that has not already been spoken for.
      free.find((t) => tableNameFromUrn(t.urn).toLowerCase() === key) ??
      null
    );
  };

  state.docs = [];
  for (const doc of result.datasets) {
    const target = claim(doc.name);
    if (!target) continue;
    taken.add(target.urn);
    state.docs.push({
      urn: target.urn,
      name: target.label,
      description: doc.description,
    });
  }

  const missed = targets.filter((t) => !taken.has(t.urn));
  emit({
    lane: "codegen",
    node: "generate_docs",
    type: "node_complete",
    label:
      missed.length === 0
        ? `Drafted ${state.docs.length} description(s)`
        : `Drafted ${state.docs.length} description(s) — none returned for ${missed.map((m) => m.label).join(", ")}`,
    data: { docs: state.docs },
  });
};

const validateSqlStage: StageHandler = async ({ state, emit }) => {
  if (!state.sql) {
    throw new Error("Nothing to validate — no SQL was generated upstream");
  }

  let lastErrors: string[] = [];
  for (let attempt = 0; attempt <= MAX_CORRECTIONS; attempt++) {
    if (attempt > 0) {
      // Re-fire the generate stage; its canvas node lights up again.
      const regen = await generateSql(state, emit, attempt, lastErrors);
      state.sql = regen.sql;
      state.modelName = regen.model_name;
      state.notes = regen.notes;
      state.attempts = attempt + 1;
    }

    emit({
      lane: "codegen",
      node: "validate_sql",
      type: "node_start",
      label: "Validating column references against the real schema (sqlglot)",
    });
    emit({
      lane: "codegen",
      node: "validate_sql",
      type: "tool_call",
      label: `POST validator /validate (dialect=${state.dialect})`,
    });

    const validation = await postValidator(state.sql!, state);
    state.validation = validation;

    if (validation.valid) {
      emit({
        lane: "codegen",
        node: "validate_sql",
        type: "node_complete",
        label: `Valid ✓ — ${validation.columnsUsed.length} column${validation.columnsUsed.length === 1 ? "" : "s"} across ${validation.tablesUsed.length} table${validation.tablesUsed.length === 1 ? "" : "s"}`,
        data: validation,
      });
      return;
    }

    lastErrors = validation.errors;
    emit({
      lane: "codegen",
      node: "validate_sql",
      type: attempt < MAX_CORRECTIONS ? "tool_result" : "error",
      label: `Invalid (${validation.stage}): ${validation.errors[0] ?? "unknown"}${
        attempt < MAX_CORRECTIONS ? " — retrying" : " — giving up"
      }`,
      data: validation,
    });
  }

  throw new Error(
    `SQL failed validation after ${state.attempts} attempt(s): ${state.validation?.errors.join("; ")}`,
  );
};

const SQL_CLAUSE =
  /\b(SELECT|FROM|INNER JOIN|LEFT JOIN|RIGHT JOIN|FULL JOIN|CROSS JOIN|JOIN|WHERE|GROUP BY|ORDER BY|HAVING|QUALIFY|LIMIT|UNION ALL|UNION)\b/gi;

/**
 * Break a one-line model at its clause boundaries. Whitespace only — no token
 * is added, removed or reordered — so what ships is still exactly what the
 * validator checked. Models arrive on one line because they come back inside
 * a JSON string field, which is no way to read a file headed for a PR.
 * Quoted spans are held out so a literal containing "from" is left alone.
 */
function formatSql(sql: string): string {
  if (sql.includes("\n")) return sql; // the model formatted it itself
  return sql
    .split(/('(?:[^']|'')*'|"(?:[^"]|"")*")/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(SQL_CLAUSE, "\n$1")))
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/\n /g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

const packageDbt: StageHandler = async ({ state, emit }) => {
  if (!state.sql || !state.modelName) {
    throw new Error("Nothing to package — no model was generated upstream");
  }

  emit({
    lane: "publisher",
    node: "package_dbt",
    type: "node_start",
    label: "Packaging PR-ready dbt model files",
  });

  const header = `-- ${state.modelName}.sql
-- Generated by Baton (https://github.com/EndPx/baton) — grounded in DataHub metadata.
-- Goal: ${state.goal}
-- Sources: ${state.entities
    .map((e) =>
      labelForUrn(
        e.urn,
        state.entities.map((x) => x.urn),
      ),
    )
    .join(", ")}
-- Validated against the live DataHub schema (sqlglot, dialect=${state.dialect}).

`;

  // A dbt schema file describes what the model returns. columnsUsed is every
  // column the query touches — join keys, filter predicates, and the full
  // expansion of any `SELECT *` — so using it declared seventeen columns for
  // a model that returns six. Fall back only if the validator is an older
  // build that does not report the output list.
  const reported = state.validation?.outputColumns ?? [];
  const columns = (
    reported.length > 0 ? reported : (state.validation?.columnsUsed ?? [])
  )
    .map((c) => c.split(".").pop()?.replace(/"/g, "").toLowerCase() ?? c)
    // `SELECT *` that qualify could not expand comes back as a star, and
    // "- name: *" is not a column a dbt schema file can describe.
    .filter((c) => c !== "*" && c.length > 0)
    .filter((v, i, arr) => arr.indexOf(v) === i);

  state.files = [
    {
      name: `${state.modelName}.sql`,
      content: header + formatSql(state.sql.trim()) + "\n",
    },
    {
      name: `${state.modelName}.yml`,
      content: `version: 2

models:
  - name: ${state.modelName}
    description: >
      ${(state.notes ?? "").replace(/\n/g, " ")}${
        // Better no columns block than one that describes columns the model
        // does not return.
        columns.length > 0
          ? `\n    columns:\n${columns.map((c) => `      - name: ${c}`).join("\n")}`
          : ""
      }
`,
    },
  ];

  emit({
    lane: "publisher",
    node: "package_dbt",
    type: "node_complete",
    label: `Packaged ${state.files.map((f) => f.name).join(" + ")}`,
    data: { files: state.files.map((f) => f.name) },
  });
};

const writeBackTags: StageHandler = async ({ state, emit }) => {
  if (!state.writeBack) {
    emit({
      lane: "publisher",
      node: "write_back_tags",
      type: "node_skipped",
      label: "Skipped — write-back is switched off",
    });
    return;
  }

  emit({
    lane: "publisher",
    node: "write_back_tags",
    type: "node_start",
    label: "Writing provenance back to the DataHub graph",
  });

  try {
    await ensureTag(
      BATON_TAG,
      "Applied by Baton to datasets that grounded a generated artifact",
    );
    emit({
      lane: "publisher",
      node: "write_back_tags",
      type: "tool_call",
      label: `DataHub GraphQL createTag("${BATON_TAG}")`,
    });
  } catch (err) {
    state.writeBackErrors.push(
      `could not ensure tag "${BATON_TAG}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const urns = state.entities.map((e) => e.urn);
  emit({
    lane: "publisher",
    node: "write_back_tags",
    type: "tool_call",
    label: `MCP add_tags("${BATON_TAG}") on ${urns.length} source dataset(s)`,
  });

  for (const urn of urns) {
    try {
      const res = await callTool(
        "add_tags",
        { tag_urns: [`urn:li:tag:${BATON_TAG}`], entity_urns: [urn] },
        { tolerateError: true },
      );
      if (res.isError) {
        state.writeBackErrors.push(
          `add_tags failed for ${urn}: ${res.raw.slice(0, 120)}`,
        );
      } else {
        state.taggedUrns.push(urn);
      }
    } catch (err) {
      state.writeBackErrors.push(
        `add_tags failed for ${urn}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  emit({
    lane: "publisher",
    node: "write_back_tags",
    type: "node_complete",
    label:
      state.writeBackErrors.length === 0
        ? `Tagged ${state.taggedUrns.length} dataset(s) with "${BATON_TAG}" — the graph now records this generation`
        : `Tagged ${state.taggedUrns.length}, ${state.writeBackErrors.length} failure(s)`,
    data: { taggedUrns: state.taggedUrns, errors: state.writeBackErrors },
  });
};

const writeBackDescription: StageHandler = async ({ state, emit }) => {
  if (!state.writeBack) {
    emit({
      lane: "publisher",
      node: "write_back_description",
      type: "node_skipped",
      label: "Skipped — write-back is switched off",
    });
    return;
  }
  if (state.docs.length === 0) {
    emit({
      lane: "publisher",
      node: "write_back_description",
      type: "node_skipped",
      label: "Skipped — no descriptions were generated upstream",
    });
    return;
  }

  emit({
    lane: "publisher",
    node: "write_back_description",
    type: "node_start",
    label: "Publishing descriptions onto the datasets",
  });

  for (const doc of state.docs) {
    // doc.name is already qualified far enough to be unique in this run.
    const label = doc.name;
    emit({
      lane: "publisher",
      node: "write_back_description",
      type: "tool_call",
      label: `MCP update_description(${label})`,
    });
    const res = await callTool(
      "update_description",
      { entity_urn: doc.urn, description: doc.description },
      { tolerateError: true },
    );
    if (res.isError) {
      state.writeBackErrors.push(
        `update_description failed for ${label}: ${res.raw.slice(0, 120)}`,
      );
    } else {
      state.describedUrns.push(doc.urn);
    }
  }

  emit({
    lane: "publisher",
    node: "write_back_description",
    type: "node_complete",
    label: `Described ${state.describedUrns.length} dataset(s) in DataHub`,
  });
};

export const STAGE_HANDLERS: Record<StageKind, StageHandler> = {
  search_entities: searchEntities,
  fetch_schema: fetchSchema,
  fetch_lineage: fetchLineage,
  dataset_queries: datasetQueries,
  generate_sql: generateSqlStage,
  generate_docs: generateDocs,
  validate_sql: validateSqlStage,
  package_dbt: packageDbt,
  write_back_tags: writeBackTags,
  write_back_description: writeBackDescription,
};
