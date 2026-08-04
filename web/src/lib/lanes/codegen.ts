/**
 * Codegen lane — generates a dbt SQL model grounded in the schema map,
 * validates it with the sqlglot service, and self-corrects on failure.
 *
 * Nodes: generate_sql → validate (→ bounded retry, max 2 corrections)
 * Hands off a CodegenResult to the Publisher lane.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  BatonContext,
  CodegenResult,
  TraceEmitter,
  ValidationReport,
} from "@/lib/baton";

const MAX_CORRECTIONS = 2;
const VALIDATOR_URL = process.env.VALIDATOR_URL ?? "http://localhost:8100";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY server-side

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    sql: {
      type: "string",
      description:
        "The dbt model SQL. Reference source tables with {{ ref('<table>') }}. Only use columns present in the schema map.",
    },
    model_name: {
      type: "string",
      description: "snake_case name for the dbt model file (no extension)",
    },
    notes: {
      type: "string",
      description: "One short paragraph explaining the model",
    },
  },
  required: ["sql", "model_name", "notes"],
  additionalProperties: false,
} as const;

interface GenOutput {
  sql: string;
  model_name: string;
  notes: string;
}

function buildSystemPrompt(ctx: BatonContext): string {
  const schemaLines = Object.entries(ctx.schemaMap)
    .map(
      ([table, cols]) =>
        `- ${table}:\n${Object.entries(cols)
          .map(([c, t]) => `    - ${c} (${t})`)
          .join("\n")}`,
    )
    .join("\n");

  return `You are Baton's Codegen agent. Generate a single dbt SQL model that fulfils the user's goal.

Hard constraints:
- Only reference the tables and columns listed in the schema map below. Never invent columns.
- Reference source tables with dbt ref() macros: {{ ref('<table_name>') }}.
- Target SQL dialect: ${ctx.dialect}.
- Output must be a complete, runnable SELECT statement (CTEs allowed).

Schema map (the only tables/columns that exist):
${schemaLines}`;
}

async function validate(
  sql: string,
  ctx: BatonContext,
): Promise<ValidationReport> {
  const res = await fetch(`${VALIDATOR_URL}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sql,
      schema_map: ctx.schemaMap,
      dialect: ctx.dialect,
    }),
  });
  if (!res.ok) {
    throw new Error(`Validator service error: HTTP ${res.status}`);
  }
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

export async function runCodegenLane(
  ctx: BatonContext,
  emit: TraceEmitter,
): Promise<CodegenResult> {
  const system = buildSystemPrompt(ctx);
  let lastErrors: string[] = [];
  let gen: GenOutput | null = null;
  let validation: ValidationReport | null = null;
  let attempts = 0;

  for (let attempt = 0; attempt <= MAX_CORRECTIONS; attempt++) {
    attempts = attempt + 1;

    // --- Node: generate_sql ---
    emit({
      lane: "codegen",
      node: "generate_sql",
      type: "node_start",
      label:
        attempt === 0
          ? "Generating dbt SQL grounded in the fetched schema"
          : `Correction attempt ${attempt}: fixing ${lastErrors[0] ?? "validation error"}`,
    });

    const userContent =
      attempt === 0
        ? `Goal: ${ctx.goal}`
        : `Goal: ${ctx.goal}

Your previous SQL failed validation with these errors:
${lastErrors.map((e) => `- ${e}`).join("\n")}

Previous SQL:
${gen?.sql ?? ""}

Fix the SQL so every referenced column exists in the schema map.`;

    emit({
      lane: "codegen",
      node: "generate_sql",
      type: "tool_call",
      label: "Anthropic API: claude-opus-5 (structured output)",
      data: { model: "claude-opus-5", attempt: attempts },
    });

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 8192,
      system,
      output_config: {
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      messages: [{ role: "user", content: userContent }],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("Model refused the generation request");
    }
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      throw new Error("No text block in model response");
    }
    gen = JSON.parse(text.text) as GenOutput;

    emit({
      lane: "codegen",
      node: "generate_sql",
      type: "node_complete",
      label: `Generated model "${gen.model_name}" (${gen.sql.length} chars)`,
      data: { sql: gen.sql, notes: gen.notes },
    });

    // --- Node: validate ---
    emit({
      lane: "codegen",
      node: "validate",
      type: "node_start",
      label: "Validating column references against the real schema (sqlglot)",
    });
    emit({
      lane: "codegen",
      node: "validate",
      type: "tool_call",
      label: `POST validator /validate (dialect=${ctx.dialect})`,
    });

    validation = await validate(gen.sql, ctx);

    if (validation.valid) {
      emit({
        lane: "codegen",
        node: "validate",
        type: "node_complete",
        label: `Valid ✓ — ${validation.columnsUsed.length} columns across ${validation.tablesUsed.length} tables`,
        data: validation,
      });
      break;
    }

    lastErrors = validation.errors;
    emit({
      lane: "codegen",
      node: "validate",
      type: attempt < MAX_CORRECTIONS ? "tool_result" : "error",
      label: `Invalid (${validation.stage}): ${validation.errors[0] ?? "unknown"}${
        attempt < MAX_CORRECTIONS ? " — retrying" : " — giving up"
      }`,
      data: validation,
    });
  }

  if (!gen || !validation) {
    throw new Error("Codegen lane produced no output");
  }
  if (!validation.valid) {
    throw new Error(
      `SQL failed validation after ${attempts} attempt(s): ${validation.errors.join("; ")}`,
    );
  }

  emit({
    lane: "codegen",
    node: "handoff",
    type: "handoff",
    label: `Baton → Publisher: validated model "${gen.model_name}" (${attempts} attempt${attempts > 1 ? "s" : ""})`,
  });

  return {
    context: ctx,
    sql: gen.sql,
    modelName: gen.model_name,
    notes: gen.notes,
    validation,
    attempts,
  };
}
