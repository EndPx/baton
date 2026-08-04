/**
 * Demo playback — a canned TraceEvent script for previewing the UI without
 * a live DataHub/Anthropic backend. Clearly labeled as demo in the UI;
 * the real pipeline always streams genuine tool-call events.
 */

import type { PublishResult, TraceEvent } from "@/lib/baton";

export interface DemoStep {
  delay: number; // ms before this event fires
  event: Omit<TraceEvent, "id" | "ts">;
}

export const DEMO_GOAL =
  "generate a dbt model joining orders and customers, filtered to the last 90 days";

export const DEMO_STEPS: DemoStep[] = [
  { delay: 300, event: { lane: "context", node: "resolve_entities", type: "node_start", label: "Resolving entities mentioned in the goal" } },
  { delay: 700, event: { lane: "context", node: "resolve_entities", type: "tool_call", label: 'MCP search("orders customers…")' } },
  { delay: 900, event: { lane: "context", node: "resolve_entities", type: "tool_result", label: "Resolved 2 dataset(s): fact_orders, dim_customers" } },
  { delay: 300, event: { lane: "context", node: "resolve_entities", type: "node_complete", label: "Entities resolved" } },
  { delay: 400, event: { lane: "context", node: "fetch_schema", type: "node_start", label: "Fetching real schemas from DataHub" } },
  { delay: 700, event: { lane: "context", node: "fetch_schema", type: "tool_call", label: "MCP list_schema_fields(fact_orders)" } },
  { delay: 800, event: { lane: "context", node: "fetch_schema", type: "tool_result", label: "fact_orders: 9 columns" } },
  { delay: 600, event: { lane: "context", node: "fetch_schema", type: "tool_call", label: "MCP list_schema_fields(dim_customers)" } },
  { delay: 800, event: { lane: "context", node: "fetch_schema", type: "tool_result", label: "dim_customers: 6 columns" } },
  { delay: 300, event: { lane: "context", node: "fetch_schema", type: "node_complete", label: "Schemas fetched" } },
  { delay: 400, event: { lane: "context", node: "fetch_lineage", type: "node_start", label: "Tracing lineage between resolved datasets" } },
  { delay: 800, event: { lane: "context", node: "fetch_lineage", type: "tool_call", label: "MCP get_lineage_paths_between(fact_orders → dim_customers)" } },
  { delay: 900, event: { lane: "context", node: "fetch_lineage", type: "tool_result", label: "Lineage paths retrieved" } },
  { delay: 300, event: { lane: "context", node: "fetch_lineage", type: "node_complete", label: "Lineage step done" } },
  { delay: 500, event: { lane: "context", node: "handoff", type: "handoff", label: "Baton → Codegen: 2 entities, 2 schemas, dialect=snowflake" } },

  { delay: 600, event: { lane: "codegen", node: "generate_sql", type: "node_start", label: "Generating dbt SQL grounded in the fetched schema" } },
  { delay: 900, event: { lane: "codegen", node: "generate_sql", type: "tool_call", label: "Anthropic API: claude-opus-5 (structured output)" } },
  { delay: 1600, event: { lane: "codegen", node: "generate_sql", type: "node_complete", label: 'Generated model "orders_with_customers_90d" (612 chars)' } },
  { delay: 400, event: { lane: "codegen", node: "validate", type: "node_start", label: "Validating column references against the real schema (sqlglot)" } },
  { delay: 700, event: { lane: "codegen", node: "validate", type: "tool_call", label: "POST validator /validate (dialect=snowflake)" } },
  { delay: 900, event: { lane: "codegen", node: "validate", type: "tool_result", label: "Invalid (qualify): Unknown column: CUSTOMER_EMAIL — retrying" } },
  { delay: 600, event: { lane: "codegen", node: "generate_sql", type: "node_start", label: "Correction attempt 1: fixing Unknown column: CUSTOMER_EMAIL" } },
  { delay: 1400, event: { lane: "codegen", node: "generate_sql", type: "node_complete", label: 'Regenerated model "orders_with_customers_90d"' } },
  { delay: 500, event: { lane: "codegen", node: "validate", type: "node_start", label: "Re-validating corrected SQL" } },
  { delay: 900, event: { lane: "codegen", node: "validate", type: "node_complete", label: "Valid ✓ — 8 columns across 2 tables" } },
  { delay: 500, event: { lane: "codegen", node: "handoff", type: "handoff", label: 'Baton → Publisher: validated model "orders_with_customers_90d" (2 attempts)' } },

  { delay: 600, event: { lane: "publisher", node: "package_output", type: "node_start", label: "Packaging PR-ready dbt model files" } },
  { delay: 800, event: { lane: "publisher", node: "package_output", type: "node_complete", label: "Packaged orders_with_customers_90d.sql + orders_with_customers_90d.yml" } },
  { delay: 400, event: { lane: "publisher", node: "write_back", type: "node_start", label: "Writing provenance back to the DataHub graph" } },
  { delay: 800, event: { lane: "publisher", node: "write_back", type: "tool_call", label: 'MCP add_tags("generated-by-baton") on 2 source dataset(s)' } },
  { delay: 900, event: { lane: "publisher", node: "write_back", type: "tool_result", label: 'Tagged 2 dataset(s) with "generated-by-baton" — the graph now records this generation' } },
  { delay: 300, event: { lane: "publisher", node: "write_back", type: "node_complete", label: "Write-back done" } },
  { delay: 400, event: { lane: "publisher", node: "handoff", type: "pipeline_complete", label: "Done: 2 files ready, 2 datasets tagged" } },
];

export const DEMO_RESULT: PublishResult = {
  files: [
    {
      name: "orders_with_customers_90d.sql",
      content: `-- orders_with_customers_90d.sql
-- Generated by Baton — grounded in DataHub metadata. (demo preview)
-- Goal: ${DEMO_GOAL}
-- Sources: fact_orders, dim_customers
-- Validated against the live DataHub schema (sqlglot, dialect=snowflake).

with orders as (
    select
        order_id,
        customer_id,
        order_total,
        order_status,
        ordered_at
    from {{ ref('fact_orders') }}
    where ordered_at >= dateadd(day, -90, current_date)
),

customers as (
    select
        customer_id,
        customer_name,
        customer_segment
    from {{ ref('dim_customers') }}
)

select
    o.order_id,
    o.ordered_at,
    o.order_total,
    o.order_status,
    c.customer_name,
    c.customer_segment
from orders o
inner join customers c
    on o.customer_id = c.customer_id
`,
    },
    {
      name: "orders_with_customers_90d.yml",
      content: `version: 2

models:
  - name: orders_with_customers_90d
    description: >
      Orders from the last 90 days joined to their customers,
      grounded in the DataHub schemas of fact_orders and dim_customers. (demo preview)
    columns:
      - name: order_id
      - name: ordered_at
      - name: order_total
      - name: order_status
      - name: customer_name
      - name: customer_segment
`,
    },
  ],
  writeBack: {
    enabled: true,
    taggedUrns: [
      "urn:li:dataset:(urn:li:dataPlatform:dbt,demo.fact_orders,PROD)",
      "urn:li:dataset:(urn:li:dataPlatform:dbt,demo.dim_customers,PROD)",
    ],
    errors: [],
  },
};
