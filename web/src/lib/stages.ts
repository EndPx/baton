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
    stage: "parse" | "qualify" | null;
    errors: string[];
    columns_used: string[];
    tables_used: string[];
  };
  return {
    valid: body.valid,
    stage: body.stage,
    errors: body.errors,
    columnsUsed: body.columns_used,
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
- Target SQL dialect: ${state.dialect}.
- Output must be a complete, runnable SELECT statement (CTEs allowed).

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
  state.dialect = dialectForPlatform(state.entities[0].platform);

  emit({
    lane: "context",
    node: "search_entities",
    type: "node_complete",
    label: `Resolved ${state.entities.length} dataset(s): ${state.entities.map((e) => e.name).join(", ")}`,
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

  for (const entity of state.entities) {
    emit({
      lane: "context",
      node: "fetch_schema",
      type: "tool_call",
      label: `MCP list_schema_fields(${entity.name})`,
    });
    // The tool's parameter is `urn`, not `dataset_urn`.
    const schema = await callTool<SchemaFieldsResponse>("list_schema_fields", {
      urn: entity.urn,
    });
    const fields = schema.data?.fields ?? schema.data?.schema_fields ?? [];
    const table = tableNameFromUrn(entity.urn);
    state.schemaMap[table] = {};
    for (const f of fields) {
      if (f.fieldPath) {
        state.schemaMap[table][f.fieldPath] =
          f.nativeDataType ?? f.type ?? "unknown";
      }
    }
    emit({
      lane: "context",
      node: "fetch_schema",
      type: "tool_result",
      label: `${table}: ${Object.keys(state.schemaMap[table]).length} columns`,
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
    label: `Schemas fetched — ${total} columns across ${Object.keys(state.schemaMap).length} table(s)`,
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
    label: `MCP get_lineage_paths_between(${state.entities[0].name} → ${state.entities[1].name})`,
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

  const collected: unknown[] = [];
  for (const entity of state.entities.slice(0, 2)) {
    emit({
      lane: "context",
      node: "dataset_queries",
      type: "tool_call",
      label: `MCP get_dataset_queries(${entity.name})`,
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
    label: collected.length
      ? `Collected sample queries for ${collected.length} dataset(s)`
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

  const result = await chatJson<{
    datasets: Array<{ name: string; description: string }>;
  }>({
    system: `You are Baton's documentation agent. Write one clear, factual sentence describing each dataset, based only on the schema below. Never invent columns or business meaning you cannot see.

Schema map:
${schemaLines(state.schemaMap)}`,
    user: `Goal: ${state.goal}\n\nDescribe these datasets: ${state.entities.map((e) => e.name).join(", ")}`,
    schemaName: "dataset_docs",
    schema: DOCS_SCHEMA as unknown as Record<string, unknown>,
    isValid: (v) => Array.isArray(v?.datasets),
    maxTokens: 2000,
  });

  state.docs = result.datasets
    .map((doc) => {
      const entity = state.entities.find(
        (e) =>
          e.name.toLowerCase() === doc.name.toLowerCase() ||
          tableNameFromUrn(e.urn).toLowerCase() === doc.name.toLowerCase(),
      );
      return entity
        ? { urn: entity.urn, name: entity.name, description: doc.description }
        : null;
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  emit({
    lane: "codegen",
    node: "generate_docs",
    type: "node_complete",
    label: `Drafted ${state.docs.length} description(s)`,
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
-- Sources: ${state.entities.map((e) => e.name).join(", ")}
-- Validated against the live DataHub schema (sqlglot, dialect=${state.dialect}).

`;

  const columns = (state.validation?.columnsUsed ?? [])
    .map((c) => c.split(".").pop()?.replace(/"/g, "").toLowerCase() ?? c)
    .filter((v, i, arr) => arr.indexOf(v) === i);

  state.files = [
    {
      name: `${state.modelName}.sql`,
      content: header + state.sql.trim() + "\n",
    },
    {
      name: `${state.modelName}.yml`,
      content: `version: 2

models:
  - name: ${state.modelName}
    description: >
      ${(state.notes ?? "").replace(/\n/g, " ")}
    columns:
${columns.map((c) => `      - name: ${c}`).join("\n")}
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
    // Two datasets can share a name across platforms; say which one.
    const label = `${doc.name} · ${platformFromUrn(doc.urn)}`;
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
