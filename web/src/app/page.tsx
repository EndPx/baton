/**
 * Landing page. The Studio itself lives at /studio — judges and first-time
 * visitors should understand what Baton does before they are handed a canvas.
 */

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  MousePointerSquareDashed,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hero } from "@/components/landing/Hero";
import { PipelineOrbit } from "@/components/landing/PipelineOrbit";

const PROBLEM_CARDS = [
  {
    icon: TriangleAlert,
    title: "The model invents columns",
    body: "Ask a general coding assistant for a dbt model and it will confidently reference customer_email on a table that has no such column. It has never seen your warehouse.",
    accent: "text-red-400",
  },
  {
    icon: ShieldCheck,
    title: "So we validate, not vibe",
    body: "Baton resolves every column against the schema DataHub actually reports, using sqlglot's schema-aware qualifier. Failures become a targeted correction, not a shrug.",
    accent: "text-sky-400",
  },
  {
    icon: Undo2,
    title: "And the knowledge stays",
    body: "The run ends by writing provenance back into the catalog. The next engineer — or the next agent — starts from what this one learned instead of rediscovering it.",
    accent: "text-emerald-400",
  },
];

const BUILD_CARDS = [
  {
    icon: MousePointerSquareDashed,
    title: "Drag the stages",
    body: "Compose the relay on a canvas from a palette of DataHub-native stages: search, schema, lineage, generate, validate, write back.",
  },
  {
    icon: Boxes,
    title: "Start from a template",
    body: "Prebuilt pipelines for the jobs people actually repeat — dbt model from two tables, documentation backfill, lineage-aware migration.",
  },
  {
    icon: Sparkles,
    title: "Or just describe it",
    body: "State the goal in plain language and let Baton lay out the pipeline for you. Then edit any stage before you run it.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="sticky top-0 z-50 border-b border-white/5 bg-slate-950/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt="Baton"
              width={28}
              height={28}
              className="rounded-md"
            />
            <span className="font-bold tracking-tight">Baton</span>
          </Link>
          <div className="flex items-center gap-1 text-sm">
            <Link
              href="#relay"
              className="hidden rounded-md px-3 py-2 text-slate-400 transition-colors hover:text-slate-100 sm:block"
            >
              The relay
            </Link>
            <Link
              href="#build"
              className="hidden rounded-md px-3 py-2 text-slate-400 transition-colors hover:text-slate-100 sm:block"
            >
              Build
            </Link>
            <Button asChild size="sm" className="ml-2 font-semibold">
              <Link href="/studio">Open Studio</Link>
            </Button>
          </div>
        </div>
      </nav>

      <Hero />
      <PipelineOrbit />

      {/* Why it matters */}
      <section className="border-t border-white/5 py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-sky-400">
            WHY IT MATTERS
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Generated data code usually fails for one boring reason.
          </h2>
        </div>
        <div className="mx-auto mt-12 grid max-w-5xl gap-4 px-6 md:grid-cols-3">
          {PROBLEM_CARDS.map((card) => (
            <div
              key={card.title}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-white/20"
            >
              <card.icon className={`h-5 w-5 ${card.accent}`} />
              <h3 className="mt-4 font-semibold">{card.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                {card.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Build it your way */}
      <section id="build" className="border-t border-white/5 py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-violet-400">
            THE STUDIO
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Three ways to build a pipeline.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-slate-400">
            The palette is deliberately narrow: every stage is a DataHub
            operation or a step that depends on one. This is a catalog-native
            builder, not a general workflow engine.
          </p>
        </div>
        <div className="mx-auto mt-12 grid max-w-5xl gap-4 px-6 md:grid-cols-3">
          {BUILD_CARDS.map((card) => (
            <div
              key={card.title}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-white/20"
            >
              <card.icon className="h-5 w-5 text-violet-300" />
              <h3 className="mt-4 font-semibold">{card.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                {card.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/5 py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight">
            Watch the baton move.
          </h2>
          <p className="mt-4 text-sm text-slate-400">
            Every node lights up from a real tool call — no decorative
            animation. Run the demo trace or point it at your own catalog.
          </p>
          <Button asChild size="lg" className="mt-8 font-semibold">
            <Link href="/studio">
              Open the Studio
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-white/5 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 text-center text-xs text-slate-500">
          <p>
            Baton — a metadata-grounded codegen relay for{" "}
            <a
              href="https://datahub.com"
              className="text-slate-400 underline-offset-4 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              DataHub
            </a>
            . Apache 2.0.
          </p>
          <p>
            Built for the{" "}
            <a
              href="https://datahub.devpost.com/"
              className="text-slate-400 underline-offset-4 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              DataHub Agent Hackathon
            </a>
            . UI primitives from shadcn/ui (MIT).
          </p>
        </div>
      </footer>
    </div>
  );
}
