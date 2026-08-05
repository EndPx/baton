"use client";

/**
 * Entity disambiguation.
 *
 * When the search matches more datasets than the run needs, the Context agent
 * stops and asks instead of quietly keeping the first few. This is the panel
 * that asks — it is the difference between an agent that guesses and one that
 * admits it does not know which "orders" you meant.
 */

import { useState } from "react";
import { Check, HelpCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChoiceRequest } from "@/lib/baton";

export function ChoicePanel({
  request,
  busy,
  onConfirm,
  onCancel,
}: {
  request: ChoiceRequest;
  busy?: boolean;
  onConfirm: (urns: string[]) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(request.preselected);

  const toggle = (urn: string) =>
    setSelected((prev) =>
      prev.includes(urn) ? prev.filter((u) => u !== urn) : [...prev, urn],
    );

  return (
    <div className="border-b border-amber-900/50 bg-amber-950/25">
      <div className="flex items-start gap-2 px-3 pt-3">
        <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
        <div>
          <h3 className="text-xs font-semibold text-amber-200">
            Which datasets did you mean?
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-amber-200/70">
            {request.reason}
          </p>
        </div>
      </div>

      <ul className="mt-2.5 space-y-1 px-3">
        {request.candidates.map((candidate) => {
          const isOn = selected.includes(candidate.urn);
          return (
            <li key={candidate.urn}>
              <button
                onClick={() => toggle(candidate.urn)}
                disabled={busy}
                className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:opacity-50 ${
                  isOn
                    ? "border-amber-400/50 bg-amber-400/10"
                    : "border-slate-700 hover:border-slate-500"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                    isOn
                      ? "border-amber-400 bg-amber-400 text-black"
                      : "border-slate-600"
                  }`}
                >
                  {isOn && <Check className="h-2.5 w-2.5" strokeWidth={4} />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium text-slate-100">
                      {candidate.name}
                    </span>
                    <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                      {candidate.platform}
                    </span>
                  </span>
                  {candidate.description && (
                    <span className="mt-0.5 line-clamp-1 block text-[10px] text-slate-500">
                      {candidate.description}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-2 px-3 py-3">
        <Button
          size="sm"
          onClick={() => onConfirm(selected)}
          disabled={busy || selected.length === 0}
          className="bg-amber-400 text-black hover:bg-amber-300"
        >
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Continue with {selected.length}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
          className="text-slate-400"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
