/**
 * POST /api/run — runs the Baton pipeline and streams TraceEvents over SSE.
 *
 * Server-side only: all Anthropic + DataHub MCP calls happen here.
 * SSE events: `trace` (TraceEvent), `result` (PublishResult), `error`.
 */

import { runPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RunRequest {
  goal?: string;
  writeBack?: boolean;
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

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      runPipeline({ goal, writeBack }, (traceEvent) => {
        send("trace", traceEvent);
      })
        .then((result) => {
          send("result", result);
        })
        .catch((err: unknown) => {
          send("error", {
            message: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          controller.close();
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
