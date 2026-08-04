/**
 * Baton pipeline orchestrator — runs the fixed three-lane relay:
 * Context → Codegen → Publisher, emitting TraceEvents throughout.
 */

import { runContextLane } from "@/lib/lanes/context";
import { runCodegenLane } from "@/lib/lanes/codegen";
import { runPublisherLane } from "@/lib/lanes/publisher";
import type { PublishResult, TraceEvent, TraceEmitter } from "@/lib/baton";

export interface PipelineOptions {
  goal: string;
  writeBack: boolean;
}

export async function runPipeline(
  options: PipelineOptions,
  onEvent: (event: TraceEvent) => void,
): Promise<PublishResult> {
  let seq = 0;
  const emit: TraceEmitter = (e) => {
    onEvent({ ...e, id: `ev_${++seq}`, ts: Date.now() });
  };

  const context = await runContextLane(options.goal, emit);
  const codegen = await runCodegenLane(context, emit);
  const result = await runPublisherLane(codegen, emit, options.writeBack);
  return result;
}
