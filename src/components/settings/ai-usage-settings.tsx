"use client";

/**
 * Settings → AI usage: running token totals per model, and the recent calls
 * with what each was for, which model ran it, whose key paid, and the prompt
 * it sent.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { formatTokens, type AiUsageEventView, type AiUsageReport } from "@/lib/ai/usage/types";
import { parseDbTimestamp } from "@/lib/stream/grouping";

const QUERY_KEY = ["ai-usage"];

const PROVIDER_LABEL: Record<string, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Claude",
  chatgpt: "ChatGPT plan",
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Something went wrong");
  return body as T;
}

function when(iso: string): string {
  const date = parseDbTimestamp(iso);
  if (!date || Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function AiUsageSettingsPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [hideIndexing, setHideIndexing] = useState(true);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => call<AiUsageReport>("/api/ai-usage?limit=100"),
  });

  const reset = useMutation({
    mutationFn: () => call<AiUsageReport>("/api/ai-usage", { method: "DELETE" }),
    onSuccess: (report) => {
      queryClient.setQueryData(QUERY_KEY, report);
      toast.success("Usage cleared. Counting starts again now.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const recent = useMemo(
    () => (data?.recent ?? []).filter((e) => !hideIndexing || e.kind !== "embedding"),
    [data, hideIndexing]
  );
  const hiddenCount = (data?.recent.length ?? 0) - recent.length;

  if (isLoading) {
    return <div className="h-24 rounded-md bg-muted animate-pulse" aria-busy="true" />;
  }
  if (isError || !data) {
    return (
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">Couldn&apos;t load AI usage.</span>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }
  if (!data.available) {
    return (
      <p className="text-sm text-muted-foreground">
        Usage tracking needs a database update on this server (npm run db:migrate).
      </p>
    );
  }

  const totalIn = data.totals.reduce((sum, t) => sum + t.inputTokens, 0);
  const totalOut = data.totals.reduce((sum, t) => sum + t.outputTokens, 0);
  const totalCalls = data.totals.reduce((sum, t) => sum + t.calls, 0);

  return (
    <div className="space-y-5">
      <section aria-labelledby="ai-usage-totals" className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="ai-usage-totals" className="text-sm font-medium">
            Tokens by model
          </h3>
          <span className="text-xs text-muted-foreground">
            {formatTokens(totalIn + totalOut)} total · {totalCalls.toLocaleString()} calls
          </span>
        </div>
        {data.totals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No AI calls recorded yet. They will show here as they happen.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Model</th>
                  <th className="px-3 py-2 text-right font-medium">Calls</th>
                  <th className="px-3 py-2 text-right font-medium">In</th>
                  <th className="px-3 py-2 text-right font-medium">Out</th>
                </tr>
              </thead>
              <tbody>
                {data.totals.map((t) => (
                  <tr key={`${t.provider}:${t.model}:${t.source}`} className="border-t">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs break-all">{t.model}</div>
                      <div className="text-xs text-muted-foreground">
                        {PROVIDER_LABEL[t.provider] ?? t.provider} · {t.source === "user" ? "your key" : "server key"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.calls.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums" title={t.inputTokens.toLocaleString()}>
                      {formatTokens(t.inputTokens)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" title={t.outputTokens.toLocaleString()}>
                      {formatTokens(t.outputTokens)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/30 text-xs">
                <tr>
                  <td className="px-3 py-2 font-medium">All models</td>
                  <td className="px-3 py-2 text-right tabular-nums">{totalCalls.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatTokens(totalIn)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatTokens(totalOut)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Counts are what each provider reported. Your provider&apos;s own dashboard is the record for billing.
        </p>
      </section>

      <section aria-labelledby="ai-usage-recent" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="ai-usage-recent" className="text-sm font-medium">
            Recent AI calls
          </h3>
          <label className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={hideIndexing}
              onChange={(e) => setHideIndexing(e.target.checked)}
            />
            Hide search indexing{hiddenCount > 0 ? ` (${hiddenCount})` : ""}
          </label>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {recent.map((event) => (
              <UsageRow key={event.id} event={event} />
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          The last 30 days are kept. Prompts are stored only in your account, trimmed to the first and last part.
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="min-h-11" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} />
          Refresh
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11"
          disabled={reset.isPending || data.totals.length === 0}
          onClick={async () => {
            const ok = await confirm({
              title: "Reset AI usage?",
              description: "This clears the totals and the call history for your account. It can't be undone.",
              confirmLabel: "Reset",
              destructive: true,
            });
            if (ok) reset.mutate();
          }}
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          Reset counts
        </Button>
      </div>
    </div>
  );
}

function UsageRow({ event }: { event: AiUsageEventView }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40"
      >
        {open ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium">{event.purpose}</span>
            {event.status === "error" && (
              <Badge variant="destructive" className="text-[10px]">
                failed
              </Badge>
            )}
          </span>
          <span className="block truncate font-mono text-xs text-muted-foreground">{event.model}</span>
        </span>
        <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          <span className="block">{when(event.createdAt)}</span>
          <span className="block">
            {formatTokens(event.inputTokens)} in · {formatTokens(event.outputTokens)} out
          </span>
        </span>
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3 pl-9 text-xs">
          <p className="text-muted-foreground">
            {PROVIDER_LABEL[event.provider] ?? event.provider} · {event.source === "user" ? "your key" : "server key"}
            {event.slot ? ` · job: ${event.slot}` : ""} · {(event.durationMs / 1000).toFixed(1)}s
          </p>
          {event.error && <p className="text-destructive break-words">{event.error}</p>}
          <div>
            <p className="mb-1 font-medium">{event.kind === "embedding" ? "Text indexed" : "Prompt sent"}</p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed">
              {event.prompt || "(empty)"}
            </pre>
          </div>
        </div>
      )}
    </li>
  );
}
