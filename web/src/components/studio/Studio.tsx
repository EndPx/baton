"use client";

/**
 * Baton Studio — one page.
 *
 * The canvas you compose is the canvas that lights up: trace events from the
 * running pipeline drive the status of the very stages you wired together,
 * and the orchestration log beside it shows every call and hand-off.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  PanelLeft,
  PanelRight,
  Play,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChoicePanel } from "@/components/studio/ChoicePanel";
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
import { deriveNodeStates, deriveStageStates } from "@/lib/traceMapping";
import { DEMO_GOAL, DEMO_RESULT, DEMO_STEPS } from "@/lib/demo";
import type { ChoiceRequest, PublishResult, TraceEvent } from "@/lib/baton";

const DND_MIME = "application/baton-stage";

type RunState = "idle" | "running" | "awaiting" | "done" | "error";

/** Canvas survives a refresh; nobody should lose a pipeline to a reload. */
const STORAGE_KEY = "baton.canvas.v1";

/** Which side panels are open — a browser preference, not part of the graph. */
const LAYOUT_KEY = "baton.layout.v1";

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
    // Sky, because this is where the Context lane's stages come from.
    <aside className="w-56 shrink-0 overflow-y-auto border-r border-sky-400/15 bg-[#070c14] p-3">
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
  const [choice, setChoice] = useState<ChoiceRequest | null>(null);
  const [showPalette, setShowPalette] = useState(true);
  const [showPanel, setShowPanel] = useState(true);
  const [rulesOpen, setRulesOpen] = useState(false);

  const idRef = useRef(100);
  const runningRef = useRef(false);
  const rejectionRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
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

  // ── Live status from the trace ───────────────────────────────────────
  const stageStates = useMemo(() => deriveStageStates(events), [events]);
  // Real runs attribute every event to the node it came from; the recorded
  // demo predates that, so it still falls back to matching by stage kind.
  const nodeStates = useMemo(() => deriveNodeStates(events), [events]);

  const summary = useMemo(() => {
    if (events.length === 0) return null;
    return {
      seconds: ((events[events.length - 1].ts - events[0].ts) / 1000).toFixed(1),
      toolCalls: events.filter((e) => e.type === "tool_call").length,
      stagesDone: new Set(
        events.filter((e) => e.type === "node_complete").map((e) => e.node),
      ).size,
    };
  }, [events]);

  /** The one selected stage, for the inspector. */
  const selectedStage = useMemo(() => {
    const picked = nodes.filter((n) => n.selected);
    return picked.length === 1 ? STAGE_BY_KIND[picked[0].data.kind] : null;
  }, [nodes]);

  // ── Canvas persistence ───────────────────────────────────────────────
  // Restored after mount, never during render: the server has no
  // localStorage, so seeding initial state from it would not hydrate.
  const skipFirstSaveRef = useRef(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<PipelineGraph> & {
        goal?: string;
      };
      if (!saved.nodes?.length) return;
      const flow = graphToFlow(saved as PipelineGraph);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setActiveTemplate("");
      if (saved.goal) setGoal(saved.goal);
      // Keep generated ids clear of the restored ones.
      idRef.current = saved.nodes.reduce(
        (max, n) => Math.max(max, Number(n.id.replace(/\D/g, "")) || 0),
        100,
      );
    } catch {
      // Corrupt or unavailable storage is not worth failing the app over.
    }
  }, [setNodes, setEdges]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { palette?: boolean; panel?: boolean };
      if (typeof saved.palette === "boolean") setShowPalette(saved.palette);
      if (typeof saved.panel === "boolean") setShowPanel(saved.panel);
    } catch {
      // preference only — never worth failing over
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        LAYOUT_KEY,
        JSON.stringify({ palette: showPalette, panel: showPanel }),
      );
    } catch {
      // preference only
    }
  }, [showPalette, showPanel]);

  useEffect(() => {
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false;
      return;
    }
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          goal,
          nodes: nodes.map((n) => ({
            id: n.id,
            kind: n.data.kind,
            position: n.position,
          })),
          edges: edges.map((e) => ({ source: e.source, target: e.target })),
        }),
      );
    } catch {
      // Quota or private mode — the canvas still works, it just will not persist.
    }
  }, [nodes, edges, goal]);

  const displayNodes = useMemo(
    () =>
      nodes.map((n) => {
        const state = nodeStates[n.id] ?? stageStates[n.data.kind];
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
  const run = useCallback(
    async (selections?: string[]) => {
      if (runningRef.current || !goal.trim() || blocking.length > 0) return;
      runningRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      setRunState("running");
      setChoice(null);
      setEvents([]);
      setResult(null);
      setErrorMsg(null);
      let paused = false;
      try {
        const res = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            goal,
            writeBack,
            selections,
            graph: { nodes: graphNodes, edges: graphEdges },
          }),
        });
        if (!res.ok || !res.body) {
          throw new Error(`Request failed: HTTP ${res.status}`);
        }
        await consumeSse(res.body, (event, data) => {
          if (event === "trace") {
            setEvents((prev) => [...prev, JSON.parse(data) as TraceEvent]);
          } else if (event === "choice") {
            paused = true;
            setChoice(JSON.parse(data) as ChoiceRequest);
            setRunState("awaiting");
          } else if (event === "result") {
            setResult(JSON.parse(data) as PublishResult);
            setRunState("done");
          } else if (event === "error") {
            const payload = JSON.parse(data) as { message: string };
            setErrorMsg(payload.message);
            setRunState("error");
          }
        });
        if (!paused) setRunState((s) => (s === "running" ? "done" : s));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setRunState("idle");
        } else {
          setErrorMsg(err instanceof Error ? err.message : String(err));
          setRunState("error");
        }
      } finally {
        runningRef.current = false;
        abortRef.current = null;
      }
    },
    [goal, writeBack, blocking.length, graphNodes, graphEdges],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  // Cmd/Ctrl+Enter runs from anywhere, including the goal field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run]);

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
    // The canvas is the deepest surface; the panels around it are raised and
    // tinted with their lane's colour so each zone reads as its own place.
    <div className="flex h-screen flex-col bg-[#05070c] text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/[0.07] bg-[#0a0d14] px-4 py-2.5">
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

        <button
          onClick={() => setShowPalette((v) => !v)}
          title={showPalette ? "Hide the stage palette" : "Show the stage palette"}
          aria-pressed={showPalette}
          className={`rounded-md p-1.5 transition-colors ${
            showPalette
              ? "bg-slate-800 text-slate-200"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          <PanelLeft className="h-4 w-4" />
        </button>

        <span className="truncate text-xs text-slate-500">
          {activeTemplate
            ? TEMPLATES.find((t) => t.id === activeTemplate)?.name
            : "Custom pipeline"}
        </span>

        <button
          onClick={() => setShowPanel((v) => !v)}
          title={showPanel ? "Hide the side panel" : "Show the side panel"}
          aria-pressed={showPanel}
          className={`ml-auto rounded-md p-1.5 transition-colors ${
            showPanel
              ? "bg-slate-800 text-slate-200"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          <PanelRight className="h-4 w-4" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {showPalette && <Palette />}

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

        {showPanel && (
        <aside className="flex w-96 shrink-0 flex-col border-l border-emerald-400/15 bg-[#060f0c]">
          {/* The agent asking rather than guessing */}
          {choice && (
            <ChoicePanel
              request={choice}
              busy={runState === "running"}
              onConfirm={(urns) => void run(urns)}
              onCancel={() => {
                setChoice(null);
                setRunState("idle");
              }}
            />
          )}

          {summary && (
            <div className="flex items-center gap-3 border-b border-slate-800 px-3 py-2 text-[10px] text-slate-400">
              <span>{summary.seconds}s</span>
              <span>{summary.toolCalls} tool calls</span>
              <span>{summary.stagesDone} stages</span>
              {result && (
                <span className="text-emerald-400">
                  {result.files.length} files
                </span>
              )}
              {runState === "running" && (
                <span className="ml-auto text-sky-300">running…</span>
              )}
              {runState === "awaiting" && (
                <span className="ml-auto text-amber-300">waiting on you</span>
              )}
            </div>
          )}

          {selectedStage && (
            <div className="border-b border-slate-800 px-3 py-2">
              <p className="text-[10px] font-semibold tracking-[0.15em] text-slate-500 uppercase">
                Stage
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-100">
                {selectedStage.label}
              </p>
              <code className="mt-0.5 block font-mono text-[10px] text-sky-300">
                {selectedStage.tool}
              </code>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                {selectedStage.description}
              </p>
            </div>
          )}

          {/* Rules */}
          <section className="max-h-56 shrink-0 overflow-y-auto border-b border-slate-800">
            <button
              onClick={() => setRulesOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-left"
            >
              {rulesOpen ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-slate-500" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-slate-500" />
              )}
              <h2 className="text-[10px] font-semibold tracking-[0.15em] text-slate-500 uppercase">
                Rules
              </h2>
              {issues.length === 0 ? (
                <span className="ml-auto text-[10px] text-emerald-400">
                  ✓ pipeline is valid
                </span>
              ) : (
                <span className="ml-auto text-[10px] text-amber-400">
                  {blocking.length} blocking · {issues.length - blocking.length}{" "}
                  advisory
                </span>
              )}
            </button>
            {/* Blocking violations are never collapsed away — they stop a run. */}
            {issues.length > 0 && (rulesOpen || blocking.length > 0) && (
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
        )}
      </div>

      {/* Composer — the goal belongs where you type, at the bottom. */}
      <footer className="flex items-center gap-3 border-t border-violet-400/20 bg-[#0b0916] px-4 py-3">
        <input
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm outline-none placeholder:text-slate-600 focus:border-sky-500"
          placeholder='Describe the model you want — e.g. "join orders and customers, last 90 days"'
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
          variant="outline"
          onClick={runDemo}
          disabled={runState === "running"}
          title="Replay a recorded trace (no backend calls)"
          className="shrink-0 border-white/15"
        >
          Demo
        </Button>

        {runState === "running" ? (
          <Button
            variant="outline"
            onClick={stop}
            title="Stop this run"
            className="shrink-0 border-red-500/40 font-semibold text-red-300 hover:bg-red-500/10"
          >
            <Square className="mr-1.5 h-3 w-3 fill-current" />
            Stop
          </Button>
        ) : (
          <Button
            onClick={() => void run()}
            disabled={!goal.trim() || blocking.length > 0}
            title={
              blocking.length > 0
                ? "Fix the rule violations before running"
                : "Run the pipeline (Ctrl/Cmd + Enter)"
            }
            className="shrink-0 font-semibold"
          >
            <Play className="mr-1.5 h-4 w-4" />
            Run
          </Button>
        )}
      </footer>
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
