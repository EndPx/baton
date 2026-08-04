"use client";

/**
 * Baton Studio — one page.
 *
 * The canvas you compose is the canvas that lights up: trace events from the
 * running pipeline drive the status of the very stages you wired together,
 * and the orchestration log beside it shows every call and hand-off.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertTriangle, Loader2, Play, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RunLog } from "@/components/studio/RunLog";
import { nodeTypes, type StageNodeType } from "@/components/studio/StageNode";
import {
  LANE_ACCENT,
  LANE_LABEL,
  STAGES,
  STAGE_BY_KIND,
  type Lane,
  type StageKind,
} from "@/lib/nodes/registry";
import {
  blockingIssues,
  canConnect,
  validateGraph,
  type GraphEdgeLike,
  type GraphNodeLike,
} from "@/lib/nodes/rules";
import {
  DEFAULT_TEMPLATE,
  TEMPLATES,
  type PipelineGraph,
} from "@/lib/templates";
import { deriveStageStates } from "@/lib/traceMapping";
import { DEMO_GOAL, DEMO_RESULT, DEMO_STEPS } from "@/lib/demo";
import type { PublishResult, TraceEvent } from "@/lib/baton";

const DND_MIME = "application/baton-stage";

/** Stage kinds the current runner actually executes. */
const EXECUTABLE_KINDS: StageKind[] = [
  "search_entities",
  "fetch_schema",
  "fetch_lineage",
  "generate_sql",
  "validate_sql",
  "package_dbt",
  "write_back_tags",
];

type RunState = "idle" | "running" | "done" | "error";

function graphToFlow(graph: PipelineGraph): {
  nodes: StageNodeType[];
  edges: Edge[];
} {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: "stage" as const,
      position: n.position,
      data: { kind: n.kind },
    })),
    edges: graph.edges.map((e) => ({
      id: `${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      style: { stroke: "#475569" },
    })),
  };
}

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

function Palette() {
  const lanes: Lane[] = ["context", "codegen", "publisher"];
  return (
    <aside className="w-56 shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-950 p-3">
      <p className="px-1 pb-2 text-[10px] font-semibold tracking-[0.15em] text-slate-500 uppercase">
        Stage palette
      </p>
      {lanes.map((lane) => (
        <div key={lane} className="mb-4">
          <p
            className={`mb-1.5 px-1 text-[10px] font-semibold tracking-wide uppercase ${LANE_ACCENT[lane].text}`}
          >
            {LANE_LABEL[lane]}
          </p>
          <div className="space-y-1.5">
            {STAGES.filter((s) => s.lane === lane).map((stage) => {
              const Icon = stage.icon;
              return (
                <div
                  key={stage.kind}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_MIME, stage.kind);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  title={stage.description}
                  className="flex cursor-grab items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-2 transition-colors hover:border-slate-600 active:cursor-grabbing"
                >
                  <Icon
                    className={`h-3.5 w-3.5 shrink-0 ${LANE_ACCENT[lane].text}`}
                  />
                  <span className="truncate text-xs text-slate-200">
                    {stage.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <p className="px-1 text-[10px] leading-relaxed text-slate-600">
        Drag a stage onto the canvas. Connections that would break grounding are
        refused — the rules panel explains why.
      </p>
    </aside>
  );
}

function StudioInner() {
  const initial = useMemo(() => graphToFlow(DEFAULT_TEMPLATE), []);
  const [nodes, setNodes, onNodesChange] = useNodesState<StageNodeType>(
    initial.nodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [activeTemplate, setActiveTemplate] = useState(DEFAULT_TEMPLATE.id);
  const [goal, setGoal] = useState(DEFAULT_TEMPLATE.sampleGoal);
  const [writeBack, setWriteBack] = useState(true);
  const [runState, setRunState] = useState<RunState>("idle");
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [composeGoal, setComposeGoal] = useState("");
  const [composing, setComposing] = useState(false);

  const idRef = useRef(100);
  const runningRef = useRef(false);
  const rejectionRef = useRef<string | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  // ── Rules ────────────────────────────────────────────────────────────
  const graphNodes: GraphNodeLike[] = useMemo(
    () => nodes.map((n) => ({ id: n.id, kind: n.data.kind })),
    [nodes],
  );
  const graphEdges: GraphEdgeLike[] = useMemo(
    () => edges.map((e) => ({ source: e.source, target: e.target })),
    [edges],
  );
  const issues = useMemo(
    () => validateGraph(graphNodes, graphEdges),
    [graphNodes, graphEdges],
  );
  const blocking = useMemo(() => blockingIssues(issues), [issues]);

  const notWired = useMemo(
    () =>
      [...new Set(graphNodes.map((n) => n.kind))].filter(
        (k) => !EXECUTABLE_KINDS.includes(k),
      ),
    [graphNodes],
  );

  // ── Live status from the trace ───────────────────────────────────────
  const stageStates = useMemo(() => deriveStageStates(events), [events]);

  const displayNodes = useMemo(
    () =>
      nodes.map((n) => {
        const state = stageStates[n.data.kind];
        return {
          ...n,
          data: {
            ...n.data,
            status: state?.status ?? "idle",
            detail: state?.detail,
            hasIssue: blocking.some((i) => i.nodeId === n.id),
          },
        };
      }),
    [nodes, stageStates, blocking],
  );

  const displayEdges = useMemo(
    () =>
      edges.map((e) => {
        const targetKind = nodes.find((n) => n.id === e.target)?.data.kind;
        const status = targetKind ? stageStates[targetKind]?.status : undefined;
        return {
          ...e,
          animated: status === "running",
          style: {
            stroke:
              status === "running"
                ? "#38bdf8"
                : status === "done"
                  ? "#4ade80"
                  : "#475569",
          },
        };
      }),
    [edges, nodes, stageStates],
  );

  // ── Canvas interactions ──────────────────────────────────────────────
  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const { source, target } = connection;
      if (!source || !target) return false;
      const verdict = canConnect(source, target, graphNodes, graphEdges);
      if (!verdict.ok) rejectionRef.current = verdict.reason ?? null;
      return verdict.ok;
    },
    [graphNodes, graphEdges],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      rejectionRef.current = null;
      setConnectionError(null);
      setEdges((eds) =>
        addEdge({ ...params, style: { stroke: "#475569" } }, eds),
      );
    },
    [setEdges],
  );

  const onConnectEnd = useCallback(() => {
    if (rejectionRef.current) {
      setConnectionError(rejectionRef.current);
      rejectionRef.current = null;
    }
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData(DND_MIME) as StageKind;
      if (!kind) return;
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      setNodes((nds) => [
        ...nds,
        {
          id: `n${++idRef.current}`,
          type: "stage" as const,
          position,
          data: { kind },
        },
      ]);
      setActiveTemplate("");
    },
    [screenToFlowPosition, setNodes],
  );

  const loadTemplate = useCallback(
    (template: PipelineGraph) => {
      const flow = graphToFlow(template);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setActiveTemplate(template.id);
      setGoal(template.sampleGoal);
      setConnectionError(null);
      setEvents([]);
      setResult(null);
      setErrorMsg(null);
      setRunState("idle");
    },
    [setNodes, setEdges],
  );

  const compose = useCallback(async () => {
    if (!composeGoal.trim() || composing) return;
    setComposing(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: composeGoal }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? `HTTP ${res.status}`);
      const flow = graphToFlow(payload as PipelineGraph);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setActiveTemplate("");
      setGoal(composeGoal);
      setEvents([]);
      setResult(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setComposing(false);
    }
  }, [composeGoal, composing, setNodes, setEdges]);

  // ── Running ──────────────────────────────────────────────────────────
  const run = useCallback(async () => {
    if (runningRef.current || !goal.trim() || blocking.length > 0) return;
    runningRef.current = true;
    setRunState("running");
    setEvents([]);
    setResult(null);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal,
          writeBack,
          graph: { nodes: graphNodes, edges: graphEdges },
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`Request failed: HTTP ${res.status}`);
      }
      await consumeSse(res.body, (event, data) => {
        if (event === "trace") {
          setEvents((prev) => [...prev, JSON.parse(data) as TraceEvent]);
        } else if (event === "result") {
          setResult(JSON.parse(data) as PublishResult);
          setRunState("done");
        } else if (event === "error") {
          const payload = JSON.parse(data) as { message: string };
          setErrorMsg(payload.message);
          setRunState("error");
        }
      });
      setRunState((s) => (s === "running" ? "done" : s));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setRunState("error");
    } finally {
      runningRef.current = false;
    }
  }, [goal, writeBack, blocking.length, graphNodes, graphEdges]);

  const runDemo = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    loadTemplate(DEFAULT_TEMPLATE);
    setGoal(DEMO_GOAL);
    setRunState("running");
    setEvents([]);
    setResult(null);
    setErrorMsg(null);
    let seq = 0;
    for (const step of DEMO_STEPS) {
      await new Promise((r) => setTimeout(r, step.delay));
      setEvents((prev) => [
        ...prev,
        { ...step.event, id: `demo_${++seq}`, ts: Date.now() },
      ]);
    }
    setResult(DEMO_RESULT);
    setRunState("done");
    runningRef.current = false;
  }, [loadTemplate]);

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-4 py-2.5">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="Baton"
            width={26}
            height={26}
            className="rounded-md"
            priority
          />
          <span className="font-bold tracking-tight">Baton</span>
        </Link>

        <input
          className="min-w-64 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm outline-none placeholder:text-slate-600 focus:border-sky-500"
          placeholder='e.g. "generate a dbt model joining orders and customers"'
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          disabled={runState === "running"}
        />

        <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={writeBack}
            onChange={(e) => setWriteBack(e.target.checked)}
            disabled={runState === "running"}
          />
          Write back
        </label>

        <Button
          size="sm"
          onClick={run}
          disabled={
            runState === "running" || !goal.trim() || blocking.length > 0
          }
          title={
            blocking.length > 0
              ? "Fix the rule violations before running"
              : "Run the pipeline"
          }
          className="font-semibold"
        >
          {runState === "running" ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="mr-1.5 h-3.5 w-3.5" />
          )}
          Run
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={runDemo}
          disabled={runState === "running"}
          title="Replay a recorded trace (no backend calls)"
          className="border-white/15"
        >
          Demo
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <Palette />

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-2">
            {TEMPLATES.map((template) => (
              <button
                key={template.id}
                onClick={() => loadTemplate(template)}
                title={template.description}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  activeTemplate === template.id
                    ? "border-sky-400/60 bg-sky-400/10 text-sky-200"
                    : "border-slate-700 text-slate-300 hover:border-slate-500"
                }`}
              >
                {template.name}
              </button>
            ))}

            <div className="ml-auto flex items-center gap-2">
              <input
                value={composeGoal}
                onChange={(e) => setComposeGoal(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && compose()}
                placeholder="Describe a pipeline…"
                className="w-56 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs outline-none placeholder:text-slate-600 focus:border-violet-400"
              />
              <Button
                size="sm"
                onClick={compose}
                disabled={composing || !composeGoal.trim()}
                className="bg-violet-500 text-white hover:bg-violet-400"
              >
                {composing ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                )}
                Compose
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Clear the canvas"
                onClick={() => {
                  setNodes([]);
                  setEdges([]);
                  setActiveTemplate("");
                }}
                className="text-slate-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {connectionError && (
            <button
              onClick={() => setConnectionError(null)}
              className="w-full border-b border-amber-900/60 bg-amber-950/50 px-4 py-2 text-left text-xs text-amber-200"
            >
              Connection refused: {connectionError}{" "}
              <span className="text-amber-400/70">(click to dismiss)</span>
            </button>
          )}

          <div
            className="min-h-0 flex-1"
            onDrop={onDrop}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
          >
            <ReactFlow
              nodes={displayNodes}
              edges={displayEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              isValidConnection={isValidConnection}
              nodeTypes={nodeTypes}
              fitView
              colorMode="dark"
              proOptions={{ hideAttribution: true }}
              deleteKeyCode={["Backspace", "Delete"]}
            >
              <Background gap={22} />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                className="!bg-slate-900"
                maskColor="rgba(2,6,23,0.7)"
              />
            </ReactFlow>
          </div>
        </main>

        <aside className="flex w-96 shrink-0 flex-col border-l border-slate-800">
          {/* Rules */}
          <section className="max-h-56 shrink-0 overflow-y-auto border-b border-slate-800">
            <div className="flex items-center justify-between px-3 py-2">
              <h2 className="text-[10px] font-semibold tracking-[0.15em] text-slate-500 uppercase">
                Rules
              </h2>
              {issues.length === 0 ? (
                <span className="text-[10px] text-emerald-400">
                  ✓ pipeline is valid
                </span>
              ) : (
                <span className="text-[10px] text-amber-400">
                  {blocking.length} blocking · {issues.length - blocking.length}{" "}
                  advisory
                </span>
              )}
            </div>
            {issues.length > 0 && (
              <ul className="space-y-1 px-3 pb-2">
                {issues.map((issue, i) => (
                  <li
                    key={`${issue.nodeId ?? "graph"}-${i}`}
                    className={`flex gap-1.5 rounded px-2 py-1.5 text-[11px] leading-snug ${
                      issue.level === "error"
                        ? "bg-red-950/40 text-red-200"
                        : "bg-amber-950/30 text-amber-200"
                    }`}
                  >
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            )}
            {notWired.length > 0 && (
              <p className="px-3 pb-2 text-[10px] leading-snug text-slate-500">
                Runner coverage:{" "}
                {notWired.map((k) => STAGE_BY_KIND[k].label).join(", ")}{" "}
                {notWired.length === 1 ? "is" : "are"} on the canvas but not yet
                executed by the backend — those stages stay idle during a run.
              </p>
            )}
          </section>

          {/* Orchestration log */}
          <section className="flex min-h-0 flex-1 flex-col border-b border-slate-800">
            <h2 className="shrink-0 px-3 py-2 text-[10px] font-semibold tracking-[0.15em] text-slate-500 uppercase">
              Orchestration
            </h2>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <RunLog events={events} />
            </div>
          </section>

          {/* Deliverable */}
          <section className="flex max-h-[45%] min-h-0 flex-col">
            <h2 className="shrink-0 px-3 py-2 text-[10px] font-semibold tracking-[0.15em] text-slate-500 uppercase">
              Deliverable
            </h2>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {errorMsg && (
                <div className="mb-2 rounded-lg border border-red-800 bg-red-950 p-2.5 text-[11px] text-red-200">
                  {errorMsg}
                </div>
              )}
              {!result && !errorMsg && (
                <p className="text-xs text-slate-500">
                  Generated files appear here when the relay finishes.
                </p>
              )}
              {result?.files.map((file) => (
                <div key={file.name} className="mb-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="truncate font-mono text-[11px] text-sky-400">
                      {file.name}
                    </span>
                    <button
                      className="rounded bg-slate-800 px-2 py-0.5 text-[10px] hover:bg-slate-700"
                      onClick={() =>
                        navigator.clipboard.writeText(file.content)
                      }
                    >
                      Copy
                    </button>
                  </div>
                  <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 p-2.5 text-[10px] leading-relaxed">
                    {file.content}
                  </pre>
                </div>
              ))}
              {result?.writeBack.enabled && (
                <p className="text-[11px] text-emerald-400">
                  ✓ Provenance written back:{" "}
                  {result.writeBack.taggedUrns.length} dataset(s) tagged in
                  DataHub
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export function Studio() {
  return (
    <ReactFlowProvider>
      <StudioInner />
    </ReactFlowProvider>
  );
}
