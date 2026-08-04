"use client";

/**
 * The pipeline builder: drag stages from the palette onto the canvas, start
 * from a template, or describe the goal and let Baton lay the pipeline out.
 *
 * The palette is scoped to DataHub operations by design — see
 * lib/nodes/registry.ts.
 */

import { useCallback, useRef, useState } from "react";
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
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  LANE_ACCENT,
  LANE_LABEL,
  STAGES,
  type Lane,
  type StageKind,
} from "@/lib/nodes/registry";
import {
  DEFAULT_TEMPLATE,
  TEMPLATES,
  type PipelineGraph,
} from "@/lib/templates";
import { nodeTypes, type StageNodeType } from "@/components/studio/StageNode";

const DND_MIME = "application/baton-stage";

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
      animated: true,
      style: { stroke: "#475569" },
    })),
  };
}

function Palette() {
  const lanes: Lane[] = ["context", "codegen", "publisher"];
  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-950 p-3">
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
        Drag a stage onto the canvas. Connect stages by dragging between the
        dots; select and press Backspace to delete.
      </p>
    </aside>
  );
}

function BuilderCanvas() {
  const initial = graphToFlow(DEFAULT_TEMPLATE);
  const [nodes, setNodes, onNodesChange] = useNodesState<StageNodeType>(
    initial.nodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [activeTemplate, setActiveTemplate] = useState(DEFAULT_TEMPLATE.id);
  const [composeGoal, setComposeGoal] = useState("");
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const idRef = useRef(100);
  const { screenToFlowPosition } = useReactFlow();

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge(
          { ...params, animated: true, style: { stroke: "#475569" } },
          eds,
        ),
      ),
    [setEdges],
  );

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
    },
    [screenToFlowPosition, setNodes],
  );

  const loadTemplate = useCallback(
    (template: PipelineGraph) => {
      const flow = graphToFlow(template);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setActiveTemplate(template.id);
      setComposeError(null);
    },
    [setNodes, setEdges],
  );

  const compose = useCallback(async () => {
    if (!composeGoal.trim() || composing) return;
    setComposing(true);
    setComposeError(null);
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
    } catch (err) {
      setComposeError(err instanceof Error ? err.message : String(err));
    } finally {
      setComposing(false);
    }
  }, [composeGoal, composing, setNodes, setEdges]);

  return (
    <div className="flex min-h-0 flex-1">
      <Palette />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Template + AI compose bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-2.5">
          <span className="text-[10px] font-semibold tracking-[0.15em] text-slate-500 uppercase">
            Templates
          </span>
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
              className="w-72 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs outline-none placeholder:text-slate-600 focus:border-violet-400"
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

        {composeError && (
          <div className="border-b border-red-900/60 bg-red-950/60 px-4 py-2 text-xs text-red-200">
            Compose failed: {composeError}
          </div>
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
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
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
      </div>
    </div>
  );
}

export function Builder() {
  return (
    <ReactFlowProvider>
      <BuilderCanvas />
    </ReactFlowProvider>
  );
}
