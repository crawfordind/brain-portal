"use client";

/**
 * Settings → AI provider: the account's own API keys.
 *
 * Three ways to pay for AI: connect OpenRouter in one click (it mints a key
 * for this app), or paste an OpenRouter, OpenAI or Claude key. Every pasted
 * key is tested with its provider before it is saved, and the panel says, for
 * each kind of work, which provider and whose key will actually run it.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ClipboardPaste, ExternalLink, KeyRound, LogIn, Loader2, Plug, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import type { AiKeysStatus, EffectiveRoute } from "@/lib/ai/credentials/status";
import { PROVIDER_INFO, type AiKeySummary, type AiProvider, type ProviderInfo } from "@/lib/ai/credentials/types";

const QUERY_KEY = ["ai-keys"];

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Something went wrong");
  return body as T;
}

const CONNECT_ERRORS: Record<string, string> = {
  cancelled: "OpenRouter connection was cancelled.",
  expired: "That OpenRouter connection took too long or started in another browser. Try again.",
  exchange_failed: "OpenRouter didn't issue a key. Try connecting again.",
  save_failed: "Couldn't save the OpenRouter key. Try again.",
  disabled: "Personal AI keys are turned off on this server.",
  no_secret: "This server can't store keys yet. Ask the person who runs it to set AI_KEY_ENCRYPTION_SECRET.",
  callback_not_https: "Connecting OpenRouter needs this app to be served over https.",
};

const WORK_LABELS: Record<keyof AiKeysStatus["effective"], string> = {
  chat: "Writing, summaries and agents",
  vision: "Handwriting and images",
  embedding: "Search index",
};

function routeName(provider: AiProvider, source: "user" | "server"): string {
  if (provider === "chatgpt") return "your ChatGPT plan";
  return `${PROVIDER_INFO[provider].label}, ${source === "user" ? "your key" : "this server's key"}`;
}

function routeText(route: EffectiveRoute): string {
  if (!route.ok) return route.message;
  const first = routeName(route.provider, route.source);
  const backups = route.backups ?? [];
  return backups.length > 0 ? `${first}; if that fails: ${backups.map((b) => routeName(b.provider, b.source)).join(", then ")}` : first;
}

export function AiProviderSettingsPanel() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => call<AiKeysStatus>("/api/ai-keys"),
  });

  // The OpenRouter connect flow comes back here with a result in the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("ai") === "connected";
    const error = params.get("ai_error");
    if (!connected && !error) return;
    if (connected) toast.success("OpenRouter connected. AI now runs on your OpenRouter account.");
    if (error) toast.error(CONNECT_ERRORS[error] ?? "Connecting OpenRouter didn't work. Try again.");
    params.delete("ai");
    params.delete("ai_error");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }, [queryClient]);

  const setStatus = (status: AiKeysStatus) => queryClient.setQueryData(QUERY_KEY, status);

  const setPreferred = useMutation({
    mutationFn: (preferred: AiProvider) =>
      call<AiKeysStatus>("/api/ai-keys", { method: "PATCH", body: JSON.stringify({ preferred }) }),
    onSuccess: setStatus,
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="h-16 rounded-md bg-muted animate-pulse" />
        <div className="h-24 rounded-md bg-muted animate-pulse" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">Couldn&apos;t load your AI keys.</span>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }

  const keyFor = (provider: AiProvider) => data.keys.find((k) => k.provider === provider) ?? null;
  const chatProvider = data.effective.chat.ok ? data.effective.chat.provider : null;

  return (
    <div className="space-y-5">
      {/* Where each kind of work runs, in the resolver's own words. */}
      <section aria-labelledby="ai-routing-heading" className="rounded-md border p-3 space-y-2">
        <h3 id="ai-routing-heading" className="text-sm font-medium">What runs your AI right now</h3>
        <ul className="space-y-1.5">
          {(Object.keys(WORK_LABELS) as Array<keyof AiKeysStatus["effective"]>).map((work) => {
            const route = data.effective[work];
            return (
              <li key={work} className="flex items-start gap-2 text-sm">
                {route.ok ? (
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-green-600" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
                )}
                <span>
                  <span className="font-medium">{WORK_LABELS[work]}:</span>{" "}
                  <span className={route.ok ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"}>
                    {routeText(route)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        {data.jobs?.length > 0 && (
          <div className="pt-1">
            <h4 className="text-xs font-medium text-muted-foreground">Model for each job</h4>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {data.jobs.map((job) => (
                <div key={job.slot} className="contents">
                  <dt className="text-muted-foreground">{job.label}</dt>
                  <dd className="min-w-0 truncate font-mono text-xs leading-5" title={job.model ?? undefined}>
                    {job.model ?? (job.provider ? "chosen when it runs" : "not available")}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </section>

      {!data.personalKeysEnabled ? (
        <p className="text-sm text-muted-foreground">
          Personal AI keys are turned off on this server. Everything runs on the server&apos;s own key.
        </p>
      ) : (
        <>
          {!data.encryptionReady && (
            <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
              This server can&apos;t store keys safely yet. Ask the person who runs it to set AI_KEY_ENCRYPTION_SECRET.
            </p>
          )}

          <div className="space-y-3">
            {data.providers.map((info) =>
              info.signInOnly ? (
                <ChatGptCard
                  key={info.provider}
                  info={info}
                  saved={keyFor(info.provider)}
                  access={data.chatgpt}
                  background={data.routing.chatgptBackground}
                  disabled={!data.encryptionReady}
                  isActive={chatProvider === info.provider && data.effective.chat.ok}
                  onStatus={setStatus}
                />
              ) : (
              <ProviderCard
                key={info.provider}
                info={info}
                saved={keyFor(info.provider)}
                disabled={!data.encryptionReady}
                isActive={chatProvider === info.provider && data.effective.chat.ok && data.effective.chat.source === "user"}
                canPrefer={data.keys.length > 1 && Boolean(keyFor(info.provider)) && chatProvider !== info.provider}
                onPrefer={() => setPreferred.mutate(info.provider)}
                onStatus={setStatus}
              />
              )
            )}
          </div>

          <RoutingSettings data={data} onStatus={setStatus} />

          {data.directModels && <DirectModels models={data.directModels} onStatus={setStatus} />}

          <p className="text-xs text-muted-foreground">
            Keys are encrypted on the server and only ever sent to their own provider. Usage is billed to your
            account with that provider.
            {data.serverKey && data.policy === "user_or_server" && " Without a key of your own, this server's key is used."}
          </p>
        </>
      )}
    </div>
  );
}

function statusBadge(saved: AiKeySummary) {
  if (saved.status === "ok") return <Badge variant="secondary">Working</Badge>;
  if (saved.status === "invalid") return <Badge variant="destructive">Rejected</Badge>;
  if (saved.status === "unreadable") return <Badge variant="destructive">Re-enter</Badge>;
  return <Badge variant="outline">Saved</Badge>;
}

function ProviderCard({
  info,
  saved,
  disabled,
  isActive,
  canPrefer,
  onPrefer,
  onStatus,
}: {
  info: ProviderInfo;
  saved: AiKeySummary | null;
  disabled: boolean;
  isActive: boolean;
  canPrefer: boolean;
  onPrefer: () => void;
  onStatus: (status: AiKeysStatus) => void;
}) {
  const confirm = useConfirm();
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState(false);
  const inputId = `ai-key-${info.provider}`;

  const save = useMutation({
    mutationFn: () =>
      call<{ message: string; status: AiKeysStatus }>("/api/ai-keys", {
        method: "PUT",
        body: JSON.stringify({ provider: info.provider, apiKey: key }),
      }),
    onSuccess: ({ message, status }) => {
      setKey("");
      setEditing(false);
      onStatus(status);
      toast.success(message);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const test = useMutation({
    mutationFn: () =>
      call<{ ok: boolean; message: string; status: AiKeysStatus }>("/api/ai-keys/test", {
        method: "POST",
        body: JSON.stringify({ provider: info.provider }),
      }),
    onSuccess: ({ ok, message, status }) => {
      onStatus(status);
      if (ok) toast.success(message);
      else toast.error(message);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: () => call<AiKeysStatus>(`/api/ai-keys?provider=${info.provider}`, { method: "DELETE" }),
    onSuccess: (status) => {
      onStatus(status);
      toast.success(`${info.label} key removed`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const showForm = !saved || editing;

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {info.label}
            {saved && statusBadge(saved)}
            {isActive && <Badge>In use</Badge>}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{info.description}</p>
          {saved && (
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              {saved.hint}
              {saved.source === "connect" && <span className="font-sans"> · connected</span>}
            </p>
          )}
          {saved?.lastError && saved.status !== "ok" && (
            <p className="text-xs text-destructive mt-1">{saved.lastError}</p>
          )}
        </div>
      </div>

      {saved && !editing && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            Test
          </Button>
          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={() => setEditing(true)}>
            <KeyRound className="h-3.5 w-3.5 mr-1.5" />
            Replace
          </Button>
          {canPrefer && (
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={onPrefer}>
              Use this one first
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 sm:min-h-9 text-destructive"
            disabled={remove.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: `Remove your ${info.label} key?`,
                description: "AI work that used it will switch to another key you've saved, or stop if there isn't one.",
                confirmLabel: "Remove",
                destructive: true,
              });
              if (ok) remove.mutate();
            }}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Remove
          </Button>
        </div>
      )}

      {showForm && (
        <div className="space-y-2">
          {info.supportsConnect && !saved && (
            <Button asChild className="w-full min-h-11 sm:min-h-9" disabled={disabled}>
              <a href="/api/ai-keys/openrouter/connect" aria-disabled={disabled}>
                <Plug className="h-4 w-4 mr-2" />
                Connect OpenRouter (creates a key for you)
              </a>
            </Button>
          )}
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim()) save.mutate();
            }}
          >
            <label htmlFor={inputId} className="sr-only">
              {info.label} API key
            </label>
            <Input
              id={inputId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={`Paste your ${info.label} key (${info.keyPrefixes[0]}…)`}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={disabled || save.isPending}
              className="flex-1 h-11 sm:h-10 font-mono text-xs"
            />
            <div className="flex gap-2">
              <Button type="submit" className="flex-1 sm:flex-none h-11 sm:h-10" disabled={disabled || save.isPending || !key.trim()}>
                {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {save.isPending ? "Testing…" : "Test & save"}
              </Button>
              {editing && (
                <Button type="button" variant="ghost" className="h-11 sm:h-10" onClick={() => { setEditing(false); setKey(""); }}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
          <a
            href={info.keysUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Get a {info.label} key <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </div>
  );
}

const DEFAULT_VALUE = "__default__";

function DirectModels({
  models,
  onStatus,
}: {
  models: NonNullable<AiKeysStatus["directModels"]>;
  onStatus: (status: AiKeysStatus) => void;
}) {
  const label = PROVIDER_INFO[models.provider].label;
  const save = useMutation({
    mutationFn: (update: { slot: string; id: string | null }) =>
      call<AiKeysStatus>("/api/ai-keys/models", {
        method: "PUT",
        body: JSON.stringify({ provider: models.provider, models: { [update.slot]: update.id } }),
      }),
    onSuccess: (status) => {
      onStatus(status);
      toast.success("Model saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section aria-labelledby="ai-direct-models" className="space-y-3">
      <div>
        <h3 id="ai-direct-models" className="text-sm font-medium">{label} models</h3>
        <p className="text-xs text-muted-foreground">
          Which of your {label} models runs each job.
          {models.provider === "anthropic" &&
            " Everyday tasks run constantly in the background; a smaller Claude model there costs much less."}
          {models.provider === "chatgpt" &&
            " A lighter model for everyday tasks uses less of your plan's limit; it is picked by default."}
        </p>
      </div>
      {models.slots.map((slot) => (
        <div key={slot.slot} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm">{slot.label}</p>
            <p className="text-xs text-muted-foreground font-mono">Now: {slot.current}</p>
          </div>
          {slot.options ? (
            <Select
              value={slot.selected ?? DEFAULT_VALUE}
              onValueChange={(value) => save.mutate({ slot: slot.slot, id: value === DEFAULT_VALUE ? null : value })}
              disabled={save.isPending}
            >
              <SelectTrigger className="w-full sm:w-64 h-11 sm:h-9" aria-label={`${label} model for ${slot.label}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_VALUE}>Recommended</SelectItem>
                {slot.options.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-xs text-muted-foreground">Couldn&apos;t load your model list. Test the key, then try again.</p>
          )}
        </div>
      ))}
    </section>
  );
}

/**
 * Sign in with ChatGPT. OpenAI only lets open-source apps receive the sign-in
 * on a 127.0.0.1 address, which a server can't listen on, so the last step is
 * the person pasting that address back here.
 */
function ChatGptCard({
  info,
  saved,
  access,
  background,
  disabled,
  isActive,
  onStatus,
}: {
  info: ProviderInfo;
  saved: AiKeySummary | null;
  access: AiKeysStatus["chatgpt"];
  background: boolean;
  disabled: boolean;
  isActive: boolean;
  onStatus: (status: AiKeysStatus) => void;
}) {
  const confirm = useConfirm();
  const [step, setStep] = useState<"idle" | "paste">("idle");
  const [pasted, setPasted] = useState("");
  const [allowBackground, setAllowBackground] = useState(background);

  const start = useMutation({
    mutationFn: () =>
      call<{ url: string }>("/api/ai-keys/chatgpt/start", {
        method: "POST",
        body: JSON.stringify({ background: allowBackground }),
      }),
    onSuccess: ({ url }) => {
      setStep("paste");
      // The tab was opened on the click itself, so pop-up blockers allow it.
      const tab = pendingTab.current;
      pendingTab.current = null;
      if (tab && !tab.closed) tab.location.href = url;
      else window.open(url, "_blank", "noopener");
    },
    onError: (error: Error) => {
      pendingTab.current?.close();
      pendingTab.current = null;
      toast.error(error.message);
    },
  });
  const pendingTab = useRef<Window | null>(null);
  const begin = () => {
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    pendingTab.current = tab;
    start.mutate();
  };

  const finish = useMutation({
    mutationFn: () =>
      call<{ message: string; status: AiKeysStatus }>("/api/ai-keys/chatgpt/finish", {
        method: "POST",
        body: JSON.stringify({ callbackUrl: pasted }),
      }),
    onSuccess: ({ message, status }) => {
      setPasted("");
      setStep("idle");
      onStatus(status);
      toast.success(message);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const test = useMutation({
    mutationFn: () =>
      call<{ ok: boolean; message: string; status: AiKeysStatus }>("/api/ai-keys/test", {
        method: "POST",
        body: JSON.stringify({ provider: "chatgpt" }),
      }),
    onSuccess: ({ ok, message, status }) => {
      onStatus(status);
      if (ok) toast.success(message);
      else toast.error(message);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const setBackground = useMutation({
    mutationFn: (value: boolean) =>
      call<AiKeysStatus>("/api/ai-keys", { method: "PATCH", body: JSON.stringify({ routing: { chatgptBackground: value } }) }),
    onSuccess: onStatus,
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: () => call<AiKeysStatus>("/api/ai-keys?provider=chatgpt", { method: "DELETE" }),
    onSuccess: (status) => {
      onStatus(status);
      toast.success("Signed out of ChatGPT");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {info.label}
          {saved && statusBadge(saved)}
          {isActive && <Badge>Using ChatGPT plan</Badge>}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{info.description}</p>
        {saved && <p className="text-xs text-muted-foreground mt-1">{saved.hint}</p>}
        {saved?.lastError && saved.status !== "ok" && <p className="text-xs text-destructive mt-1">{saved.lastError}</p>}
      </div>

      {!access.allowed ? (
        <p className="text-xs text-muted-foreground">{access.reason}</p>
      ) : saved && step === "idle" ? (
        <div className="space-y-3">
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <Switch
              checked={background}
              disabled={setBackground.isPending}
              onCheckedChange={(value) => setBackground.mutate(value)}
              aria-label="Use my ChatGPT plan for background work"
            />
            <span>
              Use it for background work too
              <span className="block text-xs text-muted-foreground">
                Summaries, tags and contact reading run on their own. Off: only things you ask for use your plan.
              </span>
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" disabled={test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
              Test
            </Button>
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" asChild>
              <a href={access.manageUsageUrl} target="_blank" rel="noopener noreferrer">
                Manage usage <ExternalLink className="h-3 w-3 ml-1.5" />
              </a>
            </Button>
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={begin}>
              <LogIn className="h-3.5 w-3.5 mr-1.5" />
              Sign in again
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 sm:min-h-9 text-destructive"
              disabled={remove.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: "Sign out of ChatGPT?",
                  description: "Brain Portal stops using your ChatGPT plan, and AI work moves to your other keys.",
                  confirmLabel: "Sign out",
                  destructive: true,
                });
                if (ok) remove.mutate();
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Sign out
            </Button>
          </div>
        </div>
      ) : step === "idle" ? (
        <div className="space-y-3">
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <Switch
              checked={allowBackground}
              onCheckedChange={setAllowBackground}
              aria-label="Also use my plan for background work"
            />
            <span>
              Also use my plan for background work
              <span className="block text-xs text-muted-foreground">
                Summaries, tags and contact reading. You can change this later.
              </span>
            </span>
          </label>
          <Button className="w-full min-h-11 sm:min-h-9" disabled={disabled || start.isPending} onClick={begin}>
            {start.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LogIn className="h-4 w-4 mr-2" />}
            Sign in with ChatGPT
          </Button>
          <p className="text-xs text-muted-foreground">
            Uses your Plus or Pro plan&apos;s limits instead of API credits. Brain Portal can&apos;t see your chats or
            your API key.
          </p>
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (pasted.trim()) finish.mutate();
          }}
        >
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            <li>In the ChatGPT tab that just opened, sign in and allow Brain Portal to use your plan.</li>
            <li>
              ChatGPT then sends you to a page that won&apos;t load, with an address starting{" "}
              <span className="font-mono">http://127.0.0.1</span>. That&apos;s expected.
            </li>
            <li>Copy that whole address from the address bar and paste it here.</li>
          </ol>
          <label htmlFor="chatgpt-callback" className="sr-only">
            Address from the ChatGPT sign-in
          </label>
          <Input
            id="chatgpt-callback"
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
            placeholder="http://127.0.0.1:1455/auth/callback?code=…"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            disabled={finish.isPending}
            className="h-11 sm:h-10 font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="flex-1 sm:flex-none min-h-11 sm:min-h-9" disabled={finish.isPending || !pasted.trim()}>
              {finish.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ClipboardPaste className="h-4 w-4 mr-2" />}
              {finish.isPending ? "Connecting…" : "Finish sign-in"}
            </Button>
            <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={begin} disabled={start.isPending}>
              Open ChatGPT again
            </Button>
            <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={() => { setStep("idle"); setPasted(""); }}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Backups: what happens when the first choice can't answer. */
function RoutingSettings({ data, onStatus }: { data: AiKeysStatus; onStatus: (status: AiKeysStatus) => void }) {
  const update = useMutation({
    mutationFn: (routing: Partial<AiKeysStatus["routing"]>) =>
      call<AiKeysStatus>("/api/ai-keys", { method: "PATCH", body: JSON.stringify({ routing }) }),
    onSuccess: onStatus,
    onError: (error: Error) => toast.error(error.message),
  });
  const ownKeys = data.keys.length;
  if (ownKeys === 0) return null;

  return (
    <section aria-labelledby="ai-routing-backups" className="rounded-md border p-3 space-y-3">
      <div>
        <h3 id="ai-routing-backups" className="text-sm font-medium">When one fails</h3>
        <p className="text-xs text-muted-foreground">
          Brain Portal tries the cheapest option first: a ChatGPT plan before pay-per-token keys, and a light model for
          quick background jobs. If it can&apos;t answer (out of credit or plan usage, rate limited, down, or a rejected
          key), the next one takes over. The usage log says which one ran.
        </p>
      </div>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <Switch
          checked={data.routing.fallback}
          disabled={update.isPending}
          onCheckedChange={(value) => update.mutate({ fallback: value })}
          aria-label="Back up with my other keys"
        />
        <span>
          Back up with my other keys
          <span className="block text-xs text-muted-foreground">
            {ownKeys > 1 ? "Your saved keys cover for each other." : "Add a second provider for this to matter."}
          </span>
        </span>
      </label>
      {data.serverFallbackAvailable && (
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <Switch
            checked={data.routing.serverFallback}
            disabled={update.isPending || !data.routing.fallback}
            onCheckedChange={(value) => update.mutate({ serverFallback: value })}
            aria-label="Use this server's key as a last resort"
          />
          <span>
            Then this server&apos;s key, as a last resort
            <span className="block text-xs text-muted-foreground">Billed to whoever runs this server, not to you.</span>
          </span>
        </label>
      )}
    </section>
  );
}
