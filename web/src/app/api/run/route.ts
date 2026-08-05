/**
 * POST /api/run — runs the Baton pipeline and streams TraceEvents over SSE.
 *
 * Server-side only: all LLM + DataHub MCP calls happen here.
 * SSE events: `trace` (TraceEvent), `choice` (ChoiceRequest), `result`
 * (PublishResult), `error`.
 *
 * A `choice` ends the stream. Serverless has nowhere to park a half-finished
 * run, so the client sends the picked URNs back as `selections` and the
 * pipeline starts again with them pinned — the search is one cheap call.
 */

import { runPipeline } from "@/lib/pipeline";
import { AmbiguousEntitiesError, STAGE_HANDLERS } from "@/lib/stages";
import type { RunGraph } from "@/lib/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RunRequest {
  goal?: string;
  writeBack?: boolean;
  selections?: unknown;
  graph?: unknown;
}

/**
 * Only stages that exist may run, and edges may only join nodes we were
 * given — the graph arrives from the browser, so it is input, not truth.
 */
type GraphParse =
  | { supplied: false }
  | { supplied: true; graph: RunGraph }
  | { supplied: true; error: string };

function parseGraph(raw: unknown): GraphParse {
  // No graph at all is a fair request: the default relay stands in. A graph
  // that was sent but holds nothing runnable is not — substituting a
  // different pipeline would run something the caller never asked for.
  if (!raw || typeof raw !== "object") return { supplied: false };
  const { nodes, edges } = raw as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(nodes)) return { supplied: false };
  if (nodes.length === 0) {
    return {
      supplied: true,
      error: "The pipeline is empty — add at least one stage before running.",
    };
  }

  const parsedNodes = nodes.flatMap((node) => {
    if (!node || typeof node !== "object") return [];
    const { id, kind } = node as { id?: unknown; kind?: unknown };
    if (typeof id !== "string" || typeof kind !== "string") return [];
    if (!(kind in STAGE_HANDLERS)) return [];
    return [{ id, kind: kind as keyof typeof STAGE_HANDLERS }];
  });
  if (parsedNodes.length === 0) {
    return {
      supplied: true,
      error:
        "None of the stages in the pipeline are recognised — every node was missing an id or named a stage that does not exist.",
    };
  }

  const known = new Set(parsedNodes.map((n) => n.id));
  const parsedEdges = (Array.isArray(edges) ? edges : []).flatMap((edge) => {
    if (!edge || typeof edge !== "object") return [];
    const { source, target } = edge as { source?: unknown; target?: unknown };
    if (typeof source !== "string" || typeof target !== "string") return [];
    if (!known.has(source) || !known.has(target)) return [];
    return [{ source, target }];
  });

  return { supplied: true, graph: { nodes: parsedNodes, edges: parsedEdges } };
}

/** Dataset URNs only — never let arbitrary strings reach an MCP tool call. */
const DATASET_URN = /^urn:li:dataset:\(urn:li:dataPlatform:[\w-]+,[^,)]+,\w+\)$/;

function parseSelections(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const urns = raw.filter(
    (value): value is string =>
      typeof value === "string" && DATASET_URN.test(value),
  );
  return urns.length > 0 ? urns.slice(0, 8) : undefined;
}

export async function POST(req: Request): Promise<Response> {
  let body: RunRequest;
  try {
    body = (await req.json()) as RunRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const goal = body.goal?.trim();
  if (!goal) {
    return Response.json({ error: "Missing 'goal'" }, { status: 400 });
  }
  const writeBack = body.writeBack === true;
  const selections = parseSelections(body.selections);

  const parsed = parseGraph(body.graph);
  if (parsed.supplied && "error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const graph = parsed.supplied ? parsed.graph : undefined;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      // The client going away (Stop button, closed tab) aborts the request;
      // stop writing rather than throwing on a detached controller.
      req.signal.addEventListener("abort", () => {
        closed = true;
      });

      runPipeline({ goal, writeBack, selections, graph }, (traceEvent) => {
        send("trace", traceEvent);
      })
        .then((result) => {
          send("result", result);
        })
        .catch((err: unknown) => {
          if (err instanceof AmbiguousEntitiesError) {
            send("choice", err.request);
            return;
          }
          send("error", {
            message: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          closed = true;
          try {
            controller.close();
          } catch {
            // Already closed by an aborted request.
          }
        });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
