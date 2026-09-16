"use client";

/**
 * MCP API Keys management panel.
 *
 * Lists the user's active / revoked MCP keys and allows creating and
 * revoking them. When a new key is created, the plaintext value is
 * shown exactly once (the server never stores it) and the user is
 * warned to copy it before dismissing the dialog.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Key,
  Plus,
  Trash2,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";

// ─── Types ──────────────────────────────────────────

interface KeySummary {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
  rate_limit_per_minute: number;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

interface ListResponse {
  keys: KeySummary[];
  available_scopes: string[];
}

// ─── Component ──────────────────────────────────────

const SCOPE_PRESETS: Record<string, { label: string; scopes: string[]; hint: string }> = {
  full: {
    label: "Full access",
    scopes: ["*"],
    hint: "Every tool, resource, and prompt. Use for trusted clients.",
  },
  read_only: {
    label: "Read-only",
    scopes: [
      "notes:read",
      "tasks:read",
      "projects:read",
      "captures:read",
      "search:read",
      "resources:read",
      "prompts:read",
    ],
    hint: "Listing and reading content. No mutations, no AI costs.",
  },
  ai_only: {
    label: "AI only",
    scopes: [
      "ai:search",
      "ai:insights",
      "ai:delegate",
      "search:read",
      "resources:read",
      "prompts:read",
    ],
    hint: "Semantic search, insights, and agent delegation.",
  },
  custom: {
    label: "Custom…",
    scopes: [],
    hint: "Pick exactly the scopes you want.",
  },
};

export function McpKeysPanel() {
  const [keys, setKeys] = useState<KeySummary[]>([]);
  const [availableScopes, setAvailableScopes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form state
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<keyof typeof SCOPE_PRESETS>("full");
  const [customScopes, setCustomScopes] = useState<Set<string>>(new Set());
  const [rateLimit, setRateLimit] = useState("60");
  const [expiresDays, setExpiresDays] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const confirm = useConfirm();
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mcp/keys");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || `HTTP ${res.status}`);
      }
      const payload = data as ListResponse;
      setKeys(payload.keys);
      setAvailableScopes(payload.available_scopes);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function resetForm() {
    setName("");
    setPreset("full");
    setCustomScopes(new Set());
    setRateLimit("60");
    setExpiresDays("");
    setNewKey(null);
    setCopied(false);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Give the key a name");
      return;
    }

    const scopes =
      preset === "custom" ? [...customScopes] : SCOPE_PRESETS[preset].scopes;
    if (scopes.length === 0) {
      toast.error("Select at least one scope");
      return;
    }

    const body: Record<string, unknown> = {
      name: name.trim(),
      scopes,
    };
    const rl = Number(rateLimit);
    if (Number.isFinite(rl) && rl > 0) body.rate_limit_per_minute = rl;
    const exp = Number(expiresDays);
    if (expiresDays.trim() && Number.isFinite(exp) && exp > 0) {
      body.expires_in_days = exp;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/mcp/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Server returns { error, message? } — prefer the human message.
        const msg = data.message || data.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setNewKey(data.key);
      setKeys((prev) => [data.summary, ...prev]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string, name: string) {
    const ok = await confirm({ title: `Revoke "${name}"?`, description: "Clients using this key will stop working.", destructive: true, confirmLabel: "Revoke" });
    if (!ok) return;
    try {
      const res = await fetch(`/api/mcp/keys/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || `HTTP ${res.status}`);
      }
      setKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, is_active: false } : k))
      );
      toast.success("Key revoked");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke key");
    }
  }

  async function copyKey() {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed. Select the text manually.");
    }
  }

  const activeKeys = keys.filter((k) => k.is_active);
  const revokedKeys = keys.filter((k) => !k.is_active);

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-3 space-y-1">
        <p className="text-xs font-semibold">For agents / LLMs</p>
        <p className="text-xs text-muted-foreground">
          Point your client at the docs endpoint to discover every tool,
          resource, prompt, and scope:
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a
            href="/api/mcp/docs"
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-mono underline underline-offset-2"
          >
            /api/mcp/docs
          </a>
          <span className="text-[11px] text-muted-foreground">·</span>
          <a
            href="/api/mcp/docs?format=openapi"
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-mono underline underline-offset-2"
          >
            ?format=openapi
          </a>
          <span className="text-[11px] text-muted-foreground">·</span>
          <a
            href="/api/mcp/docs?format=markdown"
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-mono underline underline-offset-2"
          >
            ?format=markdown
          </a>
        </div>
        <p className="text-[11px] text-muted-foreground pt-1">
          HTTP RPC endpoint:{" "}
          <code className="font-mono">POST /api/mcp/rpc</code> with{" "}
          <code className="font-mono">Authorization: Bearer bp_mcp_…</code>
        </p>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5 min-w-0">
          <Label className="text-sm md:text-base">MCP API Keys</Label>
          <p className="text-xs md:text-sm text-muted-foreground">
            Authorize agents and AI tools (Claude Code, Claude Desktop, or any
            MCP client) to access your Brain Portal. Each key is scoped and
            rate-limited.
          </p>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setOpen(true);
          }}
          size="sm"
          className="shrink-0 min-h-9"
        >
          <Plus className="h-4 w-4 mr-1" />
          New key
        </Button>
      </div>

      {loading ? (
        <div className="py-8 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading keys…
        </div>
      ) : keys.length === 0 ? (
        <div className="py-8 text-center rounded-lg border border-dashed text-sm text-muted-foreground">
          No API keys yet. Create one to connect an AI agent.
        </div>
      ) : (
        <div className="space-y-2">
          {activeKeys.map((k) => (
            <KeyRow key={k.id} k={k} onRevoke={handleRevoke} />
          ))}
          {revokedKeys.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                {revokedKeys.length} revoked key{revokedKeys.length === 1 ? "" : "s"}
              </summary>
              <div className="mt-2 space-y-2">
                {revokedKeys.map((k) => (
                  <KeyRow key={k.id} k={k} onRevoke={handleRevoke} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Create / show-key dialog */}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) resetForm();
        }}
      >
        <DialogContent size="standard">
          {newKey ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  Key created
                </DialogTitle>
                <DialogDescription>
                  Copy this key now — it will not be shown again. Store it in a
                  password manager or your MCP client config.
                </DialogDescription>
              </DialogHeader>

              <div className="rounded-md border bg-muted/50 p-3 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                <p className="text-xs text-muted-foreground">
                  Treat this like a password. Anyone with this key can access
                  your notes, tasks, and AI agents within the scopes you
                  granted. You can revoke it anytime.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">API key</Label>
                <div className="flex items-stretch gap-2">
                  <code className="flex-1 rounded-md border bg-background px-3 py-2 text-xs font-mono break-all">
                    {newKey}
                  </code>
                  <Button
                    type="button"
                    variant={copied ? "default" : "outline"}
                    size="sm"
                    onClick={copyKey}
                    className="shrink-0"
                  >
                    {copied ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-1" /> Copy
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <DialogFooter>
                <Button
                  onClick={() => {
                    setOpen(false);
                    resetForm();
                  }}
                >
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Create MCP API key</DialogTitle>
                <DialogDescription>
                  Keys are hashed before storage. The plaintext value is shown
                  only once, right after creation.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <Label htmlFor="mcp-key-name">Name</Label>
                <Input
                  id="mcp-key-name"
                  placeholder="e.g. Claude Code (laptop)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Scope preset</Label>
                <Select
                  value={preset}
                  onValueChange={(v) => setPreset(v as keyof typeof SCOPE_PRESETS)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SCOPE_PRESETS).map(([id, { label }]) => (
                      <SelectItem key={id} value={id}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {SCOPE_PRESETS[preset].hint}
                </p>
              </div>

              {preset === "custom" && (
                <div className="space-y-2">
                  <Label>Scopes</Label>
                  <div className="grid grid-cols-2 gap-2 rounded-md border p-3 max-h-48 overflow-y-auto">
                    {availableScopes.map((scope) => (
                      <label
                        key={scope}
                        className="flex items-center gap-2 text-xs cursor-pointer"
                      >
                        <Checkbox
                          checked={customScopes.has(scope)}
                          onCheckedChange={(checked) => {
                            setCustomScopes((prev) => {
                              const next = new Set(prev);
                              if (checked) next.add(scope);
                              else next.delete(scope);
                              return next;
                            });
                          }}
                        />
                        <span className="font-mono">{scope}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="mcp-key-rl">Rate limit (per min)</Label>
                  <Input
                    id="mcp-key-rl"
                    type="number"
                    min={1}
                    max={10000}
                    value={rateLimit}
                    onChange={(e) => setRateLimit(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mcp-key-exp">Expires in (days)</Label>
                  <Input
                    id="mcp-key-exp"
                    type="number"
                    min={1}
                    max={1825}
                    placeholder="Never"
                    value={expiresDays}
                    onChange={(e) => setExpiresDays(e.target.value)}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={creating}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Creating…
                    </>
                  ) : (
                    "Create key"
                  )}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KeyRow({
  k,
  onRevoke,
}: {
  k: KeySummary;
  onRevoke: (id: string, name: string) => void;
}) {
  const expired =
    k.expires_at !== null && new Date(k.expires_at) <= new Date();
  return (
    <div
      className={cn(
        "rounded-md border p-3 flex items-start gap-3",
        !k.is_active && "opacity-60 bg-muted/30"
      )}
    >
      <Key className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{k.name}</span>
          {!k.is_active && (
            <Badge variant="outline" className="text-[10px]">
              Revoked
            </Badge>
          )}
          {k.is_active && expired && (
            <Badge variant="outline" className="text-[10px]">
              Expired
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {k.scopes.map((s) => (
            <Badge key={s} variant="secondary" className="text-[10px] font-mono">
              {s}
            </Badge>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground font-mono">
          {k.key_prefix}… · {k.rate_limit_per_minute}/min
          {k.expires_at ? ` · expires ${new Date(k.expires_at).toLocaleDateString()}` : ""}
          {k.last_used_at
            ? ` · last used ${new Date(k.last_used_at).toLocaleString()}`
            : " · never used"}
        </p>
      </div>
      {k.is_active && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onRevoke(k.id, k.name)}
          className="shrink-0 text-destructive hover:text-destructive"
          aria-label={`Revoke ${k.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
