/**
 * Landing hero.
 *
 * Deliberately restrained: neutral black, a fine engineering grid, and one
 * piece of oversized display type that carries its own light. No colour
 * washes, no gradient text — the only glow comes from the words themselves.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";

const STATS = [
  { value: "3", label: "agent lanes" },
  { value: "18", label: "MCP tools" },
  { value: "827", label: "catalog entities" },
  { value: "100%", label: "schema-validated" },
];

export function Hero() {
  return (
    <section className="relative isolate flex min-h-screen flex-col justify-center overflow-hidden bg-[#060607]">
      {/* Fine engineering grid */}
      <div
        aria-hidden
        className="absolute inset-0 -z-20 bg-[linear-gradient(to_right,rgba(255,255,255,0.075)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.075)_1px,transparent_1px)] bg-[size:56px_56px]"
      />
      {/* Vignette: let the grid dissolve at the edges */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_75%_65%_at_50%_35%,transparent_0%,#060607_85%)]"
      />
      {/* Seam into the page background below */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-b from-transparent to-slate-950"
      />

      <div className="mx-auto w-full max-w-5xl px-6 pt-24 pb-16 text-center">
        <p className="text-[10px] font-medium tracking-[0.3em] text-white/25 uppercase">
          Built for the DataHub Agent Hackathon
        </p>

        <h1 className="mt-8 text-[clamp(2.75rem,8.5vw,6.75rem)] leading-[0.95] font-bold tracking-tight text-balance text-white [text-shadow:0_0_60px_rgba(255,255,255,0.35),0_0_120px_rgba(255,255,255,0.12)]">
          Ground before you generate.
        </h1>

        <p className="mx-auto mt-7 max-w-3xl text-base leading-relaxed text-balance text-white/45 sm:text-lg">
          Three agents read your DataHub catalog — real schemas, real lineage —
          before a line of SQL exists, then validate every model against it.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/studio"
            className="inline-flex items-center rounded-lg bg-white px-6 py-3 text-sm font-semibold text-black shadow-[0_0_50px_rgba(255,255,255,0.28)] transition-shadow hover:shadow-[0_0_70px_rgba(255,255,255,0.42)]"
          >
            Open the Studio
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
          <Link
            href="#relay"
            className="inline-flex items-center rounded-lg border border-white/15 bg-white/[0.02] px-6 py-3 text-sm font-medium text-white/80 transition-colors hover:border-white/30 hover:text-white"
          >
            See how the relay works
          </Link>
        </div>

        <dl className="mt-16 flex flex-wrap items-center justify-center divide-x divide-white/10">
          {STATS.map((stat) => (
            <div key={stat.label} className="px-6 py-2 sm:px-10">
              <dt className="text-2xl font-semibold tracking-tight text-white/90">
                {stat.value}
              </dt>
              <dd className="mt-1 text-[10px] tracking-[0.18em] text-white/30 uppercase">
                {stat.label}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
