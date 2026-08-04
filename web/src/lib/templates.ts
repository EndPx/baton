/**
 * Prebuilt pipelines. Each one is a job data teams actually repeat, expressed
 * in the stage palette so it can be edited on the canvas before running.
 */

import type { StageKind } from "@/lib/nodes/registry";

export interface GraphNode {
  id: string;
  kind: StageKind;
  position: { x: number; y: number };
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface PipelineGraph {
  id: string;
  name: string;
  description: string;
  /** Example goal that this pipeline shape is built for. */
  sampleGoal: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const COL = 300;
const ROW = 130;

export const TEMPLATES: PipelineGraph[] = [
  {
    id: "dbt-model",
    name: "Grounded dbt model",
    description:
      "The full relay: resolve the tables, ground in schema and lineage, generate, validate, package, then tag the sources.",
    sampleGoal:
      "generate a dbt model joining orders and customers, filtered to the last 90 days",
    nodes: [
      { id: "n1", kind: "search_entities", position: { x: 0, y: ROW } },
      { id: "n2", kind: "fetch_schema", position: { x: COL, y: 0 } },
      { id: "n3", kind: "fetch_lineage", position: { x: COL, y: ROW * 2 } },
      { id: "n4", kind: "generate_sql", position: { x: COL * 2, y: ROW } },
      { id: "n5", kind: "validate_sql", position: { x: COL * 3, y: ROW } },
      { id: "n6", kind: "package_dbt", position: { x: COL * 4, y: 0 } },
      {
        id: "n7",
        kind: "write_back_tags",
        position: { x: COL * 4, y: ROW * 2 },
      },
    ],
    edges: [
      { source: "n1", target: "n2" },
      { source: "n1", target: "n3" },
      { source: "n2", target: "n4" },
      { source: "n3", target: "n4" },
      { source: "n4", target: "n5" },
      { source: "n5", target: "n6" },
      { source: "n5", target: "n7" },
    ],
  },
  {
    id: "doc-backfill",
    name: "Documentation backfill",
    description:
      "Find undocumented datasets, draft descriptions grounded in schema and real usage, then publish them back to the catalog.",
    sampleGoal:
      "document the undocumented columns on the orders and customers tables",
    nodes: [
      { id: "n1", kind: "search_entities", position: { x: 0, y: ROW } },
      { id: "n2", kind: "fetch_schema", position: { x: COL, y: 0 } },
      { id: "n3", kind: "dataset_queries", position: { x: COL, y: ROW * 2 } },
      { id: "n4", kind: "generate_docs", position: { x: COL * 2, y: ROW } },
      {
        id: "n5",
        kind: "write_back_description",
        position: { x: COL * 3, y: ROW },
      },
    ],
    edges: [
      { source: "n1", target: "n2" },
      { source: "n1", target: "n3" },
      { source: "n2", target: "n4" },
      { source: "n3", target: "n4" },
      { source: "n4", target: "n5" },
    ],
  },
  {
    id: "migration-check",
    name: "Lineage-aware migration",
    description:
      "Before changing a table, walk its downstream lineage and generate migration SQL that is validated against every affected schema.",
    sampleGoal:
      "rename order_total to gross_amount on fact_orders and update everything downstream",
    nodes: [
      { id: "n1", kind: "search_entities", position: { x: 0, y: ROW } },
      { id: "n2", kind: "fetch_lineage", position: { x: COL, y: ROW } },
      { id: "n3", kind: "fetch_schema", position: { x: COL * 2, y: ROW } },
      { id: "n4", kind: "generate_sql", position: { x: COL * 3, y: ROW } },
      { id: "n5", kind: "validate_sql", position: { x: COL * 4, y: ROW } },
      { id: "n6", kind: "package_dbt", position: { x: COL * 5, y: ROW } },
    ],
    edges: [
      { source: "n1", target: "n2" },
      { source: "n2", target: "n3" },
      { source: "n3", target: "n4" },
      { source: "n4", target: "n5" },
      { source: "n5", target: "n6" },
    ],
  },
];

export const DEFAULT_TEMPLATE = TEMPLATES[0];
