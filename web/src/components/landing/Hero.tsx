/**
 * Landing hero — aurora wash over a blueprint grid, headline, and the two
 * things a judge should be able to do immediately: open the Studio or watch
 * the relay run.
 */

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const STATS = [
  { value: "3", label: "agent lanes" },
  { value: "18", label: "DataHub MCP tools" },
  { value: "827", label: "catalog entities" },
  { value: "100%", label: "schema-validated output" },
];

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      {/* Aurora wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute -top-40 left-1/4 h-[36rem] w-[36rem] animate-[aurora_18s_ease-in-out_infinite] rounded-full bg-sky-500/20 blur-[120px]" />
        <div className="absolute -top-24 right-1/4 h-[30rem] w-[30rem] animate-[aurora_22s_ease-in-out_infinite_reverse] rounded-full bg-violet-500/20 blur-[120px]" />
        <div className="absolute top-40 left-1/2 h-[26rem] w-[26rem] -translate-x-1/2 animate-[aurora_26s_ease-in-out_infinite] rounded-full bg-emerald-400/10 blur-[120px]" />
      </div>
      <div
        aria-hidden
        className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_center,black_25%,transparent_75%)]"
      />

      <div className="mx-auto flex max-w-4xl flex-col items-center px-6 pt-28 pb-24 text-center">
        <Image
          src="/logo.png"
          alt=""
          width={72}
          height={72}
          priority
          className="mb-8 animate-[float_7s_ease-in-out_infinite] rounded-2xl"
        />

        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Built for the DataHub Agent Hackathon
        </span>

        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          <span className="text-shimmer">Data pipelines</span>
          <br />
          that read the catalog first.
        </h1>

        <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-400 sm:text-lg">
          Baton is a visual builder for metadata-grounded code generation. Drag
          the stages, or let an agent compose them for you — every generated dbt
          model is validated against the real schemas and lineage in your
          DataHub catalog before it ever reaches a pull request.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="font-semibold">
            <Link href="/studio">
              Open the Studio
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="border-white/15"
          >
            <Link href="#relay">See how the relay works</Link>
          </Button>
          <Button asChild variant="ghost" size="lg" className="text-slate-400">
            <a
              href="https://github.com/EndPx/baton"
              target="_blank"
              rel="noreferrer"
            >
              <Code2 className="mr-2 h-4 w-4" />
              Source
            </a>
          </Button>
        </div>

        <dl className="mt-16 grid w-full grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/5 sm:grid-cols-4">
          {STATS.map((stat) => (
            <div key={stat.label} className="bg-slate-950/60 px-4 py-5">
              <dt className="text-2xl font-bold tracking-tight text-white">
                {stat.value}
              </dt>
              <dd className="mt-1 text-xs text-slate-400">{stat.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
