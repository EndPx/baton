/**
 * "Why three agents" — the argument for splitting the pipeline into lanes
 * with an explicit, typed hand-off rather than running one long prompt.
 *
 * The payload names shown here are the real interfaces from lib/baton.ts, so
 * this section stays honest as the pipeline evolves.
 */

import { ArrowDown, FileCode2, Search, Upload } from "lucide-react";

const LANES = [
  {
    key: "context",
    label: "Context agent",
    icon: Search,
    accent: "text-sky-300",
    ring: "border-sky-400/40",
    chip: "bg-sky-400/10 text-sky-300",
    job: "Works out what you are actually talking about.",
    does: [
      "Resolves table names into DataHub URNs, with owners, domain and tags",
      "Pulls the real column names and types for every resolved dataset",
      "Traces lineage between them so joins follow relationships that exist",
    ],
    handsOff: "BatonContext { entities, schemaMap, lineage, dialect }",
    edgeTitle: "Why it is its own agent",
    edgeBody:
      "Everything downstream is only as good as this fact sheet, so it is gathered before a single token of SQL is written. Ambiguity surfaces here as a question to you rather than a silent guess buried three steps later — and even the SQL dialect is read from platform metadata instead of assumed.",
  },
  {
    key: "codegen",
    label: "Codegen agent",
    icon: FileCode2,
    accent: "text-violet-300",
    ring: "border-violet-400/40",
    chip: "bg-violet-400/10 text-violet-300",
    job: "Writes the model, then tries to prove it wrong.",
    does: [
      "Generates a dbt model constrained to the fetched schema map",
      "Resolves every column against that schema with sqlglot's qualifier",
      "Feeds each failure back as a targeted correction, bounded to two retries",
    ],
    handsOff: "CodegenResult { sql, modelName, validation, attempts }",
    edgeTitle: "Why it is its own agent",
    edgeBody:
      "Writing and checking are deliberately different steps. A validator separate from the author produces a specific, machine-checkable complaint — “Unknown column: CUSTOMER_EMAIL” — which becomes a precise fix. A single mega-prompt can only be re-rolled and hoped over.",
  },
  {
    key: "publisher",
    label: "Publisher agent",
    icon: Upload,
    accent: "text-emerald-300",
    ring: "border-emerald-400/40",
    chip: "bg-emerald-400/10 text-emerald-300",
    job: "Ships the artifact and leaves the knowledge behind.",
    does: [
      "Packages a PR-ready .sql model plus its .yml schema file",
      "Tags the source datasets so the catalog records what fed this run",
      "Publishes generated descriptions back onto the datasets themselves",
    ],
    handsOff: "PublishResult { files, writeBack }",
    edgeTitle: "Why it is its own agent",
    edgeBody:
      "This is the only lane that can change anything outside Baton, which keeps the blast radius in one place: write-back is a switch you control, and nothing reaches your catalog until the SQL has passed validation. It is also the step that makes the next run start smarter than this one.",
  },
];

export function AgentLanes() {
  return (
    <section id="agents" className="border-t border-white/5 py-20">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <p className="text-xs font-semibold tracking-[0.2em] text-emerald-400">
          THE TEAM
        </p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          Three agents, not one long prompt.
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-slate-400">
          One prompt asked to find the tables, read the schemas, write the SQL,
          check it and update the catalog will do all of it at once — and fail
          at all of it at once. Baton splits the work into three agents that
          each finish their leg and hand a <em>typed</em> package of context to
          the next. Not shared variables inside one function: a real hand-off,
          visible in the trace.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-6xl gap-4 px-6 lg:grid-cols-3">
        {LANES.map((lane, index) => (
          <div
            key={lane.key}
            className={`flex flex-col rounded-xl border bg-white/[0.03] p-6 transition-colors ${lane.ring} hover:bg-white/[0.05]`}
          >
            <div className="flex items-center gap-2.5">
              <lane.icon className={`h-5 w-5 ${lane.accent}`} />
              <h3 className="font-semibold">{lane.label}</h3>
              <span className="ml-auto font-mono text-[10px] text-slate-600">
                leg {index + 1}/3
              </span>
            </div>

            <p className={`mt-3 text-sm font-medium ${lane.accent}`}>
              {lane.job}
            </p>

            <ul className="mt-4 space-y-2">
              {lane.does.map((item) => (
                <li
                  key={item}
                  className="flex gap-2 text-sm leading-relaxed text-slate-400"
                >
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-600" />
                  {item}
                </li>
              ))}
            </ul>

            <div className="mt-5 border-t border-white/10 pt-4">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                <ArrowDown className="h-3 w-3" />
                {index === LANES.length - 1 ? "Returns" : "Hands off"}
              </div>
              <code
                className={`mt-1.5 block rounded px-2 py-1.5 font-mono text-[10px] leading-relaxed ${lane.chip}`}
              >
                {lane.handsOff}
              </code>
            </div>

            <div className="mt-5 border-t border-white/10 pt-4">
              <h4 className="text-xs font-semibold text-slate-200">
                {lane.edgeTitle}
              </h4>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                {lane.edgeBody}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-10 max-w-3xl px-6">
        <p className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4 text-center text-sm leading-relaxed text-slate-400">
          The pay-off is that every hand-off is a checkpoint. When a run goes
          wrong you can see <em>which</em> leg dropped the baton — a table that
          resolved to the wrong dataset looks nothing like a column that failed
          validation — instead of re-reading one long answer and guessing.
        </p>
      </div>
    </section>
  );
}
