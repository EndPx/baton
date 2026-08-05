/**
 * Who Baton is for — and, just as importantly, who it is not for yet.
 *
 * The honest column is deliberate: a tool that grounds itself in a catalog is
 * worthless without one, and saying so is cheaper than a disappointed user.
 */

import { Check, X } from "lucide-react";

const FOR = [
  {
    title: "Analytics engineers on a catalogued warehouse",
    body: "If your tables already live in DataHub with their schemas ingested, Baton reads what is really there. The better your catalog, the better the model it writes.",
  },
  {
    title: "Platform teams fielding “can you build me a model?”",
    body: "Templates plus graph rules turn a recurring request into something a teammate can drive safely, without handing them the warehouse.",
  },
  {
    title: "Anyone burned by AI-generated SQL",
    body: "If you have shipped a query that referenced a column which did not exist, the validation loop is the entire point of this project.",
  },
  {
    title: "Teams whose catalog drifts out of date",
    body: "Every run writes provenance back, so documentation improves as a side effect of doing the work instead of decaying between audits.",
  },
];

const NOT_FOR = [
  {
    title: "Teams without a DataHub instance",
    body: "Baton has nothing to read, and no advantage over a plain chat model. The grounding is the product — not a feature you can skip.",
  },
  {
    title: "Catalogs with names but no schemas",
    body: "If DataHub only knows a table exists but not its columns, there is nothing to ground against. Ingest schema metadata first.",
  },
  {
    title: "Targets other than dbt, for now",
    body: "The artifact is a dbt model plus its schema file. Airflow DAGs, ingestion scripts and migrations are on the roadmap, not in the box.",
  },
  {
    title: "Anyone needing a scheduler or auto-merge",
    body: "Baton composes, generates and validates — then stops at a PR-ready file. Running models on a cadence stays with dbt Cloud, Airflow or your CI.",
  },
];

export function WhoItsFor() {
  return (
    <section
      id="fit"
      className="flex min-h-screen flex-col justify-center border-t border-white/5 py-20"
    >
      <div className="mx-auto max-w-3xl px-6 text-center">
        <p className="text-xs font-semibold tracking-[0.2em] text-sky-400">
          IS THIS FOR YOU?
        </p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          Baton is sharp, which means it is narrow.
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-slate-400">
          It does one job — generate data code that is grounded in your catalog
          — and it depends on that catalog completely. Here is where it earns
          its place, and where it honestly does not.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-5xl gap-4 px-6 md:grid-cols-2">
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/[0.04] p-6">
          <h3 className="flex items-center gap-2 font-semibold text-emerald-300">
            <Check className="h-4 w-4" />
            Built for
          </h3>
          <ul className="mt-5 space-y-5">
            {FOR.map((item) => (
              <li key={item.title}>
                <p className="text-sm font-medium text-slate-100">
                  {item.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">
                  {item.body}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
          <h3 className="flex items-center gap-2 font-semibold text-slate-300">
            <X className="h-4 w-4" />
            Not the right tool
          </h3>
          <ul className="mt-5 space-y-5">
            {NOT_FOR.map((item) => (
              <li key={item.title}>
                <p className="text-sm font-medium text-slate-200">
                  {item.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">
                  {item.body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
