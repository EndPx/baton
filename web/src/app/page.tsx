"use client";

/**
 * Baton — main page: goal prompt → live trace flow → deliverable panel.
 * The only user inputs are the goal, a write-back toggle, and (later)
 * entity disambiguation. Connection config never reaches the client.
 */

import { useCallback, useRef, useState } from "react";
import { TraceFlow } from "@/components/TraceFlow";
import type { PublishResult, TraceEvent } from "@/lib/baton";

type RunState = "idle" | "running" | "done" | "error";

/** Minimal SSE parser over a fetch body stream. */
async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (data) onEvent(event, data);
    }
  }
}

export default function Home() {
  const [goal, setGoal] = useState("");
  const [writeBack, setWriteBack] = useState(true);
  const [state, setState] = useState<RunState>("idle");
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current || !goal.trim()) return;
    runningRef.current = true;
    setState("running");
    setEvents([]);
    setResult(null);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, writeBack }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`Request failed: HTTP ${res.status}`);
      }
      await consumeSse(res.body, (event, data) => {
        if (event === "trace") {
          setEvents((prev) => [...prev, JSON.parse(data) as TraceEvent]);
        } else if (event === "result") {
          setResult(JSON.parse(data) as PublishResult);
          setState("done");
        } else if (event === "error") {
          const payload = JSON.parse(data) as { message: string };
          setErrorMsg(payload.message);
          setState("error");
        }
      });
      setState((s) => (s === "running" ? "done" : s));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState("error");
    } finally {
      runningRef.current = false;
    }
  }, [goal, writeBack]);

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-800 px-5 py-3">
        <span className="text-xl">🥍</span>
        <h1 className="text-lg font-bold tracking-tight">Baton</h1>
        <span className="text-xs text-slate-400">
          a metadata-grounded codegen relay for DataHub
        </span>
      </header>

      <div className="flex gap-3 border-b border-slate-800 px-5 py-3">
        <input
          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm outline-none placeholder:text-slate-500 focus:border-sky-500"
          placeholder='e.g. "generate a dbt model joining orders and customers, filtered to the last 90 days"'
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          disabled={state === "running"}
        />
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={writeBack}
            onChange={(e) => setWriteBack(e.target.checked)}
            disabled={state === "running"}
          />
          Write back to DataHub
        </label>
        <button
          className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold hover:bg-sky-500 disabled:opacity-40"
          onClick={run}
          disabled={state === "running" || !goal.trim()}
        >
          {state === "running" ? "Running…" : "Run"}
        </button>
      </div>

      <main className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-[3] border-r border-slate-800">
          {events.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              The live trace of Context → Codegen → Publisher will appear here.
            </div>
          ) : (
            <TraceFlow events={events} />
          )}
        </section>

        <aside className="flex min-w-0 flex-[2] flex-col overflow-y-auto p-4">
          <h2 className="mb-2 text-sm font-bold text-slate-300">Deliverable</h2>
          {errorMsg && (
            <div className="mb-3 rounded-lg border border-red-800 bg-red-950 p-3 text-xs text-red-200">
              {errorMsg}
            </div>
          )}
          {!result && !errorMsg && (
            <p className="text-xs text-slate-500">
              Generated dbt files will appear here when the relay finishes.
            </p>
          )}
          {result?.files.map((f) => (
            <div key={f.name} className="mb-4">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-xs text-sky-400">{f.name}</span>
                <button
                  className="rounded bg-slate-800 px-2 py-1 text-[10px] hover:bg-slate-700"
                  onClick={() => navigator.clipboard.writeText(f.content)}
                >
                  Copy
                </button>
              </div>
              <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 p-3 text-[11px] leading-relaxed">
                {f.content}
              </pre>
            </div>
          ))}
          {result && result.writeBack.enabled && (
            <p className="text-[11px] text-emerald-400">
              ✓ Provenance written back: {result.writeBack.taggedUrns.length}{" "}
              dataset(s) tagged in DataHub
            </p>
          )}
        </aside>
      </main>
    </div>
  );
}
