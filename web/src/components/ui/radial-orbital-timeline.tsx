"use client";

/**
 * Radial orbital timeline — nodes orbit a pulsing core; clicking one stops
 * the rotation, centers it, and highlights the nodes it hands off to.
 *
 * Adapted for Baton: each node is a real stage of the relay, and the card
 * shows the actual tool that stage calls (MCP tool, Anthropic API, sqlglot)
 * rather than a decorative progress metric.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type OrbitLane = "context" | "codegen" | "publisher";

export interface OrbitNode {
  id: number;
  title: string;
  lane: OrbitLane;
  /** The concrete call this stage makes, shown in the expanded card. */
  tool: string;
  content: string;
  icon: React.ElementType;
  /** Nodes this one hands the baton to (or back to, closing the loop). */
  relatedIds: number[];
}

interface RadialOrbitalTimelineProps {
  timelineData: OrbitNode[];
  className?: string;
}

const LANE_LABEL: Record<OrbitLane, string> = {
  context: "CONTEXT AGENT",
  codegen: "CODEGEN AGENT",
  publisher: "PUBLISHER AGENT",
};

/** Lane accents: sky = read the graph, violet = reason, emerald = write back. */
const LANE_BADGE: Record<OrbitLane, string> = {
  context: "border-sky-400/40 bg-sky-400/15 text-sky-300",
  codegen: "border-violet-400/40 bg-violet-400/15 text-violet-300",
  publisher: "border-emerald-400/40 bg-emerald-400/15 text-emerald-300",
};

const LANE_NODE: Record<OrbitLane, string> = {
  context: "border-sky-400/70 text-sky-300",
  codegen: "border-violet-400/70 text-violet-300",
  publisher: "border-emerald-400/70 text-emerald-300",
};

export default function RadialOrbitalTimeline({
  timelineData,
  className,
}: RadialOrbitalTimelineProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [rotationAngle, setRotationAngle] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);
  const [radius, setRadius] = useState(200);
  // Node positions are floating-point and the radius is measured from the
  // container, so nothing orbital can be server-rendered without a hydration
  // mismatch. The ring mounts on the client instead.
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // Orbit radius adapts to the container so the ring never overflows on mobile.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setRadius(Math.max(110, Math.min(210, w / 2 - 96)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!autoRotate) return;
    const timer = setInterval(() => {
      setRotationAngle((prev) => Number(((prev + 0.3) % 360).toFixed(3)));
    }, 50);
    return () => clearInterval(timer);
  }, [autoRotate]);

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === containerRef.current || e.target === orbitRef.current) {
      setExpandedId(null);
      setAutoRotate(true);
    }
  };

  const toggleItem = (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setAutoRotate(true);
      return;
    }
    setExpandedId(id);
    setAutoRotate(false);
    const index = timelineData.findIndex((item) => item.id === id);
    if (index >= 0) {
      setRotationAngle(270 - (index / timelineData.length) * 360);
    }
  };

  const calculateNodePosition = (index: number, total: number) => {
    const angle = ((index / total) * 360 + rotationAngle) % 360;
    const radian = (angle * Math.PI) / 180;
    return {
      x: radius * Math.cos(radian),
      y: radius * Math.sin(radian),
      zIndex: Math.round(100 + 50 * Math.cos(radian)),
      opacity: Math.max(
        0.45,
        Math.min(1, 0.45 + 0.55 * ((1 + Math.sin(radian)) / 2)),
      ),
    };
  };

  const relatedToExpanded =
    timelineData.find((item) => item.id === expandedId)?.relatedIds ?? [];

  return (
    <div
      ref={containerRef}
      onClick={handleContainerClick}
      className={`relative flex w-full items-center justify-center overflow-hidden ${className ?? "h-[560px]"}`}
    >
      <div
        ref={orbitRef}
        className="absolute flex h-full w-full items-center justify-center"
        style={{ perspective: "1000px" }}
      >
        {/* Core — the baton itself, pulsing at the center of the relay. */}
        <div className="absolute z-10 flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-gradient-to-br from-violet-500 via-sky-500 to-emerald-400">
          <div className="absolute h-20 w-20 animate-ping rounded-full border border-white/20 opacity-70" />
          <div
            className="absolute h-24 w-24 animate-ping rounded-full border border-white/10 opacity-50"
            style={{ animationDelay: "0.5s" }}
          />
          <div className="h-8 w-8 rounded-full bg-slate-950/80 backdrop-blur-md" />
        </div>

        {/* Orbit ring */}
        {mounted && (
          <div
            className="absolute rounded-full border border-white/10"
            style={{ width: radius * 2, height: radius * 2 }}
          />
        )}

        {mounted && timelineData.map((item, index) => {
          const position = calculateNodePosition(index, timelineData.length);
          const isExpanded = expandedId === item.id;
          const isRelated = relatedToExpanded.includes(item.id);
          const Icon = item.icon;

          return (
            <div
              key={item.id}
              className="absolute cursor-pointer transition-all duration-700"
              style={{
                transform: `translate(${position.x}px, ${position.y}px)`,
                zIndex: isExpanded ? 200 : position.zIndex,
                opacity: isExpanded ? 1 : position.opacity,
              }}
              onClick={(e) => {
                e.stopPropagation();
                toggleItem(item.id);
              }}
            >
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full border-2 bg-slate-950 transition-all duration-300 ${
                  isExpanded
                    ? "scale-150 border-white text-white shadow-lg shadow-white/20"
                    : isRelated
                      ? `${LANE_NODE[item.lane]} animate-pulse`
                      : LANE_NODE[item.lane]
                }`}
              >
                <Icon size={16} />
              </div>

              <div
                className={`absolute top-12 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-semibold tracking-wider transition-all duration-300 ${
                  isExpanded ? "scale-110 text-white" : "text-slate-400"
                }`}
              >
                {item.title}
              </div>

              {isExpanded && (
                <Card className="absolute top-20 left-1/2 w-72 -translate-x-1/2 overflow-visible border-white/20 bg-slate-950/95 shadow-xl shadow-black/40 backdrop-blur-lg">
                  <div className="absolute -top-3 left-1/2 h-3 w-px -translate-x-1/2 bg-white/40" />
                  <CardHeader className="p-4 pb-2">
                    <Badge
                      variant="outline"
                      className={`w-fit px-2 text-[10px] tracking-wider ${LANE_BADGE[item.lane]}`}
                    >
                      {LANE_LABEL[item.lane]}
                    </Badge>
                    <CardTitle className="mt-2 text-sm">{item.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 text-xs text-slate-300">
                    <p className="leading-relaxed">{item.content}</p>

                    <div className="mt-3 border-t border-white/10 pt-3">
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
                        Calls
                      </div>
                      <code className="font-mono text-[11px] text-sky-300">
                        {item.tool}
                      </code>
                    </div>

                    {item.relatedIds.length > 0 && (
                      <div className="mt-3 border-t border-white/10 pt-3">
                        <div className="mb-2 flex items-center text-[10px] uppercase tracking-wider text-slate-500">
                          <Link2 size={10} className="mr-1" />
                          Hands off to
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {item.relatedIds.map((relatedId) => {
                            const related = timelineData.find(
                              (i) => i.id === relatedId,
                            );
                            return (
                              <Button
                                key={relatedId}
                                variant="outline"
                                size="sm"
                                className="flex h-6 items-center border-white/20 bg-transparent px-2 py-0 text-[11px] text-slate-300 hover:bg-white/10 hover:text-white"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleItem(relatedId);
                                }}
                              >
                                {related?.title}
                                <ArrowRight
                                  size={8}
                                  className="ml-1 text-slate-500"
                                />
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
