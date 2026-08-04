"use client";

/**
 * Landing section directly under the hero: the Baton relay as an orbital
 * timeline. Every node is a real stage of the pipeline and names the tool
 * it actually calls, so the section doubles as evidence of DataHub usage.
 */

import {
  FileCode2,
  GitBranch,
  PackageCheck,
  Search,
  ShieldCheck,
  Table2,
} from "lucide-react";
import RadialOrbitalTimeline, {
  type OrbitNode,
} from "@/components/ui/radial-orbital-timeline";

const PIPELINE_NODES: OrbitNode[] = [
  {
    id: 1,
    title: "Resolve entities",
    lane: "context",
    tool: "MCP search · get_entities",
    content:
      "Turns the table names in your goal into real DataHub URNs, with owners, domain and tags attached. When several datasets match, Baton asks you instead of silently picking the first one.",
    icon: Search,
    relatedIds: [2],
  },
  {
    id: 2,
    title: "Fetch schema",
    lane: "context",
    tool: "MCP list_schema_fields",
    content:
      "Pulls the real column names and types for every resolved dataset. This is the grounding step — the model never sees an invented column, because it only ever sees this list.",
    icon: Table2,
    relatedIds: [1, 3],
  },
  {
    id: 3,
    title: "Trace lineage",
    lane: "context",
    tool: "MCP get_lineage_paths_between",
    content:
      "Follows how the datasets are actually connected upstream and downstream, so generated joins follow relationships that exist in your warehouse rather than guessed keys.",
    icon: GitBranch,
    relatedIds: [2, 4],
  },
  {
    id: 4,
    title: "Generate SQL",
    lane: "codegen",
    tool: "Anthropic API · claude-opus-5",
    content:
      "Writes a dbt model constrained to the fetched schema map, using ref() macros and the SQL dialect read from the platform metadata — not a dialect we assumed.",
    icon: FileCode2,
    relatedIds: [3, 5],
  },
  {
    id: 5,
    title: "Validate & self-correct",
    lane: "codegen",
    tool: "sqlglot qualify (schema-aware)",
    content:
      "Every column reference is resolved against the real schema. A failure is fed back as a targeted correction prompt — a bounded loop, max two retries, before surfacing the problem to you.",
    icon: ShieldCheck,
    relatedIds: [4, 6],
  },
  {
    id: 6,
    title: "Package & write back",
    lane: "publisher",
    tool: "MCP add_tags · update_description",
    content:
      "Packages a PR-ready .sql model plus its .yml schema file, then writes provenance back into DataHub so the next person — or the next agent — inherits what this run learned.",
    icon: PackageCheck,
    relatedIds: [5, 1],
  },
];

export function PipelineOrbit() {
  return (
    <section id="relay" className="relative border-t border-white/5 py-20">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <p className="text-xs font-semibold tracking-[0.2em] text-sky-400">
          THE RELAY
        </p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          Six stages. One baton.
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-slate-400">
          Three agents each run their leg and hand a structured package of
          context forward. Click any node to see what it does and which tool it
          calls — the last one hands the baton back to the catalog.
        </p>
      </div>

      <RadialOrbitalTimeline
        timelineData={PIPELINE_NODES}
        className="h-[600px]"
      />
    </section>
  );
}
