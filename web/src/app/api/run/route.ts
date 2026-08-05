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
import { AmbiguousEntitiesError } from "@/lib/lanes/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RunRequest {
  goal?: string;
  writeBack?: boolean;
  selections?: unknown;
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
  const writeBack = body.writeBack ?? false;
  const selections = parseSelections(body.selections);

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

      runPipeline({ goal, writeBack, selections }, (traceEvent) => {
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
