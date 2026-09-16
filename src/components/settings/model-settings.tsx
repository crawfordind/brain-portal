"use client";

/**
 * AI model selection.
 *
 * The list is fetched live from OpenRouter rather than hardcoded, because a
 * checked-in list is exactly what goes stale — the reason this panel exists is
 * that a pinned model was retired and the app had no way to say so or to let
 * anyone change it.
 *
 * Each setting names a *job* ("Everyday tasks", "Deep thinking") rather than a
 * model, so the choice is meaningful without knowing the vendor landscape, and
 * every job carries a recommendation the user can simply accept.
 */

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Cpu,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { CatalogModel } from "@/lib/ai/models/catalog";
import type { ResolvedSlot } from "@/lib/ai/models/resolve";
import type { ModelSlot } from "@/lib/ai/models/slots";

interface SlotView {
  slot: ModelSlot;
  label: string;
  description: string;
  usedFor: string[];
  recommendationReason: string;
  recommended: string | null;
  selected: string | null;
  resolved: ResolvedSlot;
  options: string[];
}

interface ModelsResponse {
  slots: SlotView[];
  models: CatalogModel[];
  catalog: { live: boolean; fetchedAt: string; count: number; error?: string };
}

export function ModelSettingsPanel() {
  const queryClient = useQueryClient();
  const [openSlot, setOpenSlot] = useState<ModelSlot | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const res = await fetch("/api/models");
      if (!res.ok) throw new Error("Failed to load models");
      return res.json() as Promise<ModelsResponse>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const saveMutation = useMutation({
    mutationFn: async (models: Partial<Record<ModelSlot, string | null>>) => {
      const res = await fetch("/api/models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to save");
      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
      setOpenSlot(null);
      toast.success("Model updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const refresh = useCallback(async () => {
    await fetch("/api/models?refresh=true");
    await queryClient.invalidateQueries({ queryKey: ["models"] });
    toast.success("Model list refreshed");
  }, [queryClient]);

  const modelsById = useMemo(() => {
    const map = new Map<string, CatalogModel>();
    for (const model of data?.models || []) map.set(model.id, model);
    return map;
  }, [data]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load the model list. Check that the server can reach
        openrouter.ai.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {!data.catalog.live && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <WifiOff className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-500" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            <p className="font-medium text-foreground">
              Can&apos;t reach OpenRouter&apos;s model list right now
            </p>
            <p className="mt-0.5">
              Your current settings still work — this only means the picker
              can&apos;t show what&apos;s newly available.
              {data.catalog.error ? ` (${data.catalog.error})` : ""}
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {data.catalog.live
            ? `${data.catalog.count} models available from OpenRouter`
            : "Showing your saved settings"}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={refresh}
          disabled={isFetching}
        >
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="space-y-2">
        {data.slots.map((slotView) => (
          <SlotRow
            key={slotView.slot}
            view={slotView}
            modelsById={modelsById}
            isOpen={openSlot === slotView.slot}
            onToggle={() =>
              setOpenSlot((current) => (current === slotView.slot ? null : slotView.slot))
            }
            onSelect={(modelId) =>
              saveMutation.mutate({ [slotView.slot]: modelId })
            }
            isSaving={saveMutation.isPending}
          />
        ))}
      </div>
    </div>
  );
}

// ─── One slot ────────────────────────────────────────

function SlotRow({
  view,
  modelsById,
  isOpen,
  onToggle,
  onSelect,
  isSaving,
}: {
  view: SlotView;
  modelsById: Map<string, CatalogModel>;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (modelId: string | null) => void;
  isSaving: boolean;
}) {
  const [search, setSearch] = useState("");

  const active = view.resolved.primary;
  const activeModel = modelsById.get(active);
  const usingDefault = !view.selected;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const ids = view.options.length > 0 ? view.options : [active];
    const scored = ids
      .map((id) => modelsById.get(id) || fallbackModel(id))
      .filter((model) =>
        term
          ? model.id.toLowerCase().includes(term) ||
            model.name.toLowerCase().includes(term)
          : true
      );

    // Recommended first, then whatever is currently in use, then alphabetical.
    scored.sort((a, b) => {
      const rank = (id: string) => (id === view.recommended ? 0 : id === active ? 1 : 2);
      const diff = rank(a.id) - rank(b.id);
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });

    return scored.slice(0, 60);
  }, [search, view.options, view.recommended, active, modelsById]);

  return (
    <div className="rounded-lg border">
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-muted/40 transition-colors rounded-lg"
        aria-expanded={isOpen}
      >
        <div className="flex-shrink-0 mt-0.5 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
          <Cpu className="h-4 w-4 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{view.label}</span>
            {usingDefault && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-muted-foreground/20">
                default
              </Badge>
            )}
          </div>

          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {view.description}
          </p>

          <p className="text-xs font-mono text-foreground/70 mt-1.5 truncate">
            {activeModel?.name || active}
          </p>

          {view.resolved.retiredSelection && (
            <p className="flex items-start gap-1 text-[11px] text-amber-500 mt-1.5">
              <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <span>
                <span className="font-mono">{view.resolved.retiredSelection}</span> is
                no longer offered by OpenRouter, so this switched to{" "}
                <span className="font-mono">{active}</span>.
              </span>
            </p>
          )}

          {view.resolved.source === "auto" && (
            <p className="flex items-start gap-1 text-[11px] text-muted-foreground mt-1.5">
              <Sparkles className="h-3 w-3 mt-0.5 flex-shrink-0" />
              OpenRouter is picking a model per request, because none of the
              usual choices are currently available.
            </p>
          )}
        </div>

        <ChevronDown
          className={cn(
            "h-4 w-4 flex-shrink-0 mt-1 text-muted-foreground transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen && (
        <div className="border-t p-3 space-y-3">
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Used for
            </p>
            <ul className="mt-1 space-y-0.5">
              {view.usedFor.map((use) => (
                <li key={use} className="text-xs text-muted-foreground flex gap-1.5">
                  <span className="text-muted-foreground/40">•</span>
                  {use}
                </li>
              ))}
            </ul>
          </div>

          {view.options.length > 8 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models…"
                className="h-9 pl-8 text-sm"
              />
            </div>
          )}

          <div className="max-h-72 overflow-y-auto space-y-1 -mx-1 px-1">
            {!usingDefault && (
              <button
                onClick={() => onSelect(null)}
                disabled={isSaving}
                className="w-full text-left rounded-md border border-dashed p-2 hover:bg-muted/50 transition-colors disabled:opacity-50"
              >
                <span className="text-xs font-medium">Use the recommended default</span>
                <span className="block text-[11px] text-muted-foreground mt-0.5">
                  Follows our recommendation as models change, instead of pinning one.
                </span>
              </button>
            )}

            {filtered.map((model) => (
              <ModelOption
                key={model.id}
                model={model}
                isActive={model.id === active}
                isRecommended={model.id === view.recommended}
                recommendationReason={view.recommendationReason}
                onSelect={() => onSelect(model.id)}
                disabled={isSaving}
              />
            ))}

            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No models match “{search}”.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ModelOption({
  model,
  isActive,
  isRecommended,
  recommendationReason,
  onSelect,
  disabled,
}: {
  model: CatalogModel;
  isActive: boolean;
  isRecommended: boolean;
  recommendationReason: string;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled || isActive}
      className={cn(
        "w-full text-left rounded-md border p-2 transition-colors",
        isActive ? "border-primary bg-primary/5" : "hover:bg-muted/50",
        disabled && "opacity-50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium truncate">{model.name}</span>
            {isRecommended && (
              <Badge
                variant="outline"
                className="text-[9px] px-1 py-0 h-4 bg-primary/10 text-primary border-primary/20"
              >
                Recommended
              </Badge>
            )}
          </div>
          <p className="text-[10px] font-mono text-muted-foreground truncate mt-0.5">
            {model.id}
          </p>
          {isRecommended && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {recommendationReason}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">
            {describeModel(model)}
          </p>
        </div>

        {isActive ? (
          <Check className="h-4 w-4 flex-shrink-0 text-primary" />
        ) : disabled ? (
          <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-muted-foreground" />
        ) : null}
      </div>
    </button>
  );
}

// ─── Helpers ─────────────────────────────────────────

/** A stand-in for an id the catalog doesn't describe (offline, or brand new). */
function fallbackModel(id: string): CatalogModel {
  return {
    id,
    name: id,
    contextLength: 0,
    promptCostPerMillion: null,
    completionCostPerMillion: null,
    supportsVision: false,
    description: "",
  };
}

function describeModel(model: CatalogModel): string {
  const parts: string[] = [];

  if (model.contextLength > 0) {
    parts.push(`${formatTokens(model.contextLength)} context`);
  }

  if (model.promptCostPerMillion !== null) {
    parts.push(
      model.promptCostPerMillion === 0
        ? "free"
        : `$${formatPrice(model.promptCostPerMillion)}/M in`
    );
  }
  if (model.completionCostPerMillion) {
    parts.push(`$${formatPrice(model.completionCostPerMillion)}/M out`);
  }
  if (model.supportsVision) parts.push("images");

  return parts.join(" · ") || "No pricing information";
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count % 1_000_000 === 0 ? 0 : 1)}M`;
  if (count >= 1000) return `${Math.round(count / 1000)}K`;
  return String(count);
}

function formatPrice(perMillion: number): string {
  if (perMillion < 1) return perMillion.toFixed(2);
  if (perMillion < 100) return perMillion.toFixed(2).replace(/\.00$/, "");
  return Math.round(perMillion).toString();
}
