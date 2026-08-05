/**
 * The Baton stage palette.
 *
 * Deliberately narrow: every stage is either a DataHub operation or a step
 * that consumes one. This is what keeps Baton a catalog-native builder
 * rather than a general-purpose workflow engine — there is no "HTTP request"
 * or "run script" node, and there never should be.
 */

import {
  FileCode2,
  FileText,
  GitBranch,
  History,
  PackageCheck,
  Search,
  ShieldCheck,
  Table2,
  Tag,
} from "lucide-react";

export type Lane = "context" | "codegen" | "publisher";

export type StageKind =
  | "search_entities"
  | "fetch_schema"
  | "fetch_lineage"
  | "dataset_queries"
  | "generate_sql"
  | "generate_docs"
  | "validate_sql"
  | "package_dbt"
  | "write_back_tags"
  | "write_back_description";

export interface StageDef {
  kind: StageKind;
  label: string;
  lane: Lane;
  /** The concrete call this stage makes. Shown on the node and in the trace. */
  tool: string;
  description: string;
  icon: React.ElementType;
}

export const STAGES: StageDef[] = [
  {
    kind: "search_entities",
    label: "Resolve entities",
    lane: "context",
    tool: "MCP search · get_entities",
    description:
      "Resolve table names from the goal into DataHub URNs with owners, domain and tags.",
    icon: Search,
  },
  {
    kind: "fetch_schema",
    label: "Fetch schema",
    lane: "context",
    tool: "MCP list_schema_fields",
    description:
      "Pull real column names and types for the resolved datasets. The grounding step.",
    icon: Table2,
  },
  {
    kind: "fetch_lineage",
    label: "Trace lineage",
    lane: "context",
    tool: "MCP get_lineage_paths_between",
    description:
      "Follow how datasets connect upstream and downstream so joins follow real relationships.",
    icon: GitBranch,
  },
  {
    kind: "dataset_queries",
    label: "Sample queries",
    lane: "context",
    tool: "MCP get_dataset_queries",
    description:
      "Read historical SQL against these tables to match the house style and join patterns.",
    icon: History,
  },
  {
    kind: "generate_sql",
    label: "Generate SQL",
    lane: "codegen",
    tool: "LLM API (OpenAI-compatible)",
    description:
      "Write a dbt model constrained to the fetched schema, in the dialect the platform reports.",
    icon: FileCode2,
  },
  {
    kind: "generate_docs",
    label: "Generate descriptions",
    lane: "codegen",
    tool: "LLM API (OpenAI-compatible)",
    description:
      "Draft column and table descriptions from schema, lineage and observed usage.",
    icon: FileText,
  },
  {
    kind: "validate_sql",
    label: "Validate & self-correct",
    lane: "codegen",
    tool: "sqlglot qualify",
    description:
      "Resolve every column against the real schema; failures feed back as a bounded retry.",
    icon: ShieldCheck,
  },
  {
    kind: "package_dbt",
    label: "Package dbt files",
    lane: "publisher",
    tool: "internal",
    description: "Emit a PR-ready .sql model plus its .yml schema file.",
    icon: PackageCheck,
  },
  {
    kind: "write_back_tags",
    label: "Tag sources",
    lane: "publisher",
    tool: "MCP add_tags",
    description:
      "Record in the catalog that these datasets fed a generated artifact.",
    icon: Tag,
  },
  {
    kind: "write_back_description",
    label: "Write descriptions",
    lane: "publisher",
    tool: "MCP update_description",
    description:
      "Publish the generated documentation back onto the datasets themselves.",
    icon: FileText,
  },
];

export const STAGE_BY_KIND: Record<StageKind, StageDef> = Object.fromEntries(
  STAGES.map((s) => [s.kind, s]),
) as Record<StageKind, StageDef>;

export const LANE_ACCENT: Record<
  Lane,
  { border: string; text: string; chip: string }
> = {
  context: {
    border: "border-sky-400/50",
    text: "text-sky-300",
    chip: "bg-sky-400/10 text-sky-300",
  },
  codegen: {
    border: "border-violet-400/50",
    text: "text-violet-300",
    chip: "bg-violet-400/10 text-violet-300",
  },
  publisher: {
    border: "border-emerald-400/50",
    text: "text-emerald-300",
    chip: "bg-emerald-400/10 text-emerald-300",
  },
};

export const LANE_LABEL: Record<Lane, string> = {
  context: "Context",
  codegen: "Codegen",
  publisher: "Publisher",
};
