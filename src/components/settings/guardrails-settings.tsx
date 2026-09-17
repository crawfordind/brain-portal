"use client";

/**
 * Guardrails Settings Panel
 *
 * Lets users define their AI interaction profile:
 * - Personal context (who they are)
 * - Beliefs and values
 * - Communication style preferences
 * - Topics to emphasize or avoid
 * - Custom instructions
 * - View system-learned preferences (auto-evolved)
 *
 * Shows a live preview of the compiled prompt fragment.
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  User,
  Heart,
  MessageSquare,
  Target,
  ShieldOff,
  Sparkles,
  Brain,
  Eye,
  X,
  Plus,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────

interface GuardrailsData {
  personal_context: string;
  beliefs: string;
  communication_style: string;
  topics_to_emphasize: string[];
  topics_to_avoid: string[];
  custom_instructions: string;
  learned_context: Record<string, unknown>;
  is_active: boolean;
  interaction_count: number;
  evolution_version: number;
  last_evolved_at: string | null;
}

interface GuardrailsResponse {
  guardrails: GuardrailsData;
  compiled_preview: string;
}

// ─── Component ──────────────────────────────────────

export function GuardrailsSettingsPanel() {
  const queryClient = useQueryClient();
  const [showPreview, setShowPreview] = useState(false);
  const [newEmphasize, setNewEmphasize] = useState("");
  const [newAvoid, setNewAvoid] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["guardrails"],
    queryFn: async () => {
      const res = await fetch("/api/guardrails");
      if (!res.ok) throw new Error("Failed to fetch guardrails");
      return res.json() as Promise<GuardrailsResponse>;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<GuardrailsData>) => {
      const res = await fetch("/api/guardrails", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json() as Promise<GuardrailsResponse>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["guardrails"] });
      toast.success("Guardrails updated");
    },
    onError: () => {
      toast.error("Failed to update guardrails");
    },
  });

  const evolveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/guardrails/evolve", { method: "POST" });
      if (!res.ok) throw new Error("Failed to evolve");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["guardrails"] });
      toast.success("Evolution cycle complete");
    },
    onError: () => {
      toast.error("Evolution failed — not enough interaction history");
    },
  });

  const guardrails = data?.guardrails;
  const compiledPreview = data?.compiled_preview;

  const update = useCallback(
    (field: string, value: unknown) => {
      updateMutation.mutate({ [field]: value });
    },
    [updateMutation]
  );

  if (isLoading || !guardrails) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  const addTopic = (field: "topics_to_emphasize" | "topics_to_avoid", value: string) => {
    const current = guardrails[field];
    if (!value.trim() || current.includes(value.trim())) return;
    update(field, [...current, value.trim()]);
    if (field === "topics_to_emphasize") setNewEmphasize("");
    else setNewAvoid("");
  };

  const removeTopic = (field: "topics_to_emphasize" | "topics_to_avoid", index: number) => {
    const current = [...guardrails[field]];
    current.splice(index, 1);
    update(field, current);
  };

  return (
    <div className="space-y-6">
      {/* Master Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Active</p>
          <p className="text-xs text-muted-foreground">
            Include your profile in all AI interactions
          </p>
        </div>
        <ToggleSwitch
          checked={guardrails.is_active}
          onChange={(v) => update("is_active", v)}
        />
      </div>

      {/* Personal Context */}
      <Section
        icon={User}
        title="Who You Are"
        description="Your role, expertise, and context the AI should know"
      >
        <TextAreaField
          placeholder="e.g., Senior software engineer and startup founder. Building a SaaS product in the healthcare space. 10+ years experience with distributed systems."
          value={guardrails.personal_context}
          onSave={(v) => update("personal_context", v)}
          maxLength={500}
        />
      </Section>

      {/* Beliefs & Values */}
      <Section
        icon={Heart}
        title="Beliefs & Values"
        description="Core principles that should guide AI responses"
      >
        <TextAreaField
          placeholder="e.g., Pragmatism over dogma. Ship fast, iterate faster. User experience is paramount. Open source when possible. Data-driven decisions."
          value={guardrails.beliefs}
          onSave={(v) => update("beliefs", v)}
          maxLength={500}
        />
      </Section>

      {/* Communication Style */}
      <Section
        icon={MessageSquare}
        title="Communication Style"
        description="How the AI should talk to you"
      >
        <TextAreaField
          placeholder="e.g., Direct and concise. Skip preambles. Use code examples over long explanations. Challenge my assumptions when you disagree. No corporate speak."
          value={guardrails.communication_style}
          onSave={(v) => update("communication_style", v)}
          maxLength={500}
        />
      </Section>

      {/* Topics to Emphasize */}
      <Section
        icon={Target}
        title="Emphasize"
        description="Topics and perspectives to always prioritize"
      >
        <TagInput
          tags={guardrails.topics_to_emphasize}
          inputValue={newEmphasize}
          onInputChange={setNewEmphasize}
          onAdd={(v) => addTopic("topics_to_emphasize", v)}
          onRemove={(i) => removeTopic("topics_to_emphasize", i)}
          placeholder="Add topic..."
          accentClass="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
        />
      </Section>

      {/* Topics to Avoid */}
      <Section
        icon={ShieldOff}
        title="Avoid"
        description="Topics, framing, or patterns to steer clear of"
      >
        <TagInput
          tags={guardrails.topics_to_avoid}
          inputValue={newAvoid}
          onInputChange={setNewAvoid}
          onAdd={(v) => addTopic("topics_to_avoid", v)}
          onRemove={(i) => removeTopic("topics_to_avoid", i)}
          placeholder="Add topic..."
          accentClass="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20"
        />
      </Section>

      {/* Custom Instructions */}
      <Section
        icon={Sparkles}
        title="Custom Instructions"
        description="Any additional directives for the AI"
      >
        <TextAreaField
          placeholder="e.g., Always consider cost implications. When suggesting tools, prefer ones with good TypeScript support. If I ask about architecture, think in terms of event-driven systems."
          value={guardrails.custom_instructions}
          onSave={(v) => update("custom_instructions", v)}
          maxLength={500}
        />
      </Section>

      {/* Learned Preferences (read-only, system-managed) */}
      <Section
        icon={Brain}
        title="Learned Preferences"
        description={`Auto-discovered from your interactions${guardrails.evolution_version > 0 ? ` (v${guardrails.evolution_version})` : ""}`}
      >
        <LearnedContextDisplay
          learned={guardrails.learned_context}
          interactionCount={guardrails.interaction_count}
          lastEvolved={guardrails.last_evolved_at}
          onEvolve={() => evolveMutation.mutate()}
          isEvolving={evolveMutation.isPending}
        />
      </Section>

      {/* Compiled Preview */}
      <div className="rounded-lg border bg-card">
        <button
          className="w-full flex items-center justify-between p-4 text-left"
          onClick={() => setShowPreview(!showPreview)}
        >
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            <div>
              <h3 className="text-sm font-medium">Preview</h3>
              <p className="text-xs text-muted-foreground">
                See what gets sent with every AI request
                {compiledPreview ? ` (~${Math.ceil(compiledPreview.length / 4)} tokens)` : ""}
              </p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">
            {showPreview ? "Hide" : "Show"}
          </span>
        </button>
        {showPreview && (
          <div className="px-4 pb-4">
            {compiledPreview ? (
              <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
                {compiledPreview}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                No guardrails configured yet. Fill in any section above to see the preview.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof User;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 text-primary" />
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function TextAreaField({
  value,
  placeholder,
  onSave,
  maxLength = 500,
}: {
  value: string;
  placeholder: string;
  onSave: (value: string) => void;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const isDirty = draft !== value;

  return (
    <div className="space-y-2">
      <textarea
        className="bp-field bp-field-multiline min-h-[80px] text-sm"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, maxLength))}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (isDirty) onSave(draft);
        }}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {draft.length}/{maxLength}
        </span>
        {isDirty && focused && (
          <span className="text-[10px] text-primary">
            Saves on blur
          </span>
        )}
      </div>
    </div>
  );
}

function TagInput({
  tags,
  inputValue,
  onInputChange,
  onAdd,
  onRemove,
  placeholder,
  accentClass,
}: {
  tags: string[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
  placeholder: string;
  accentClass: string;
}) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onAdd(inputValue);
    }
  };

  return (
    <div className="space-y-2">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag, i) => (
            <span
              key={`${tag}-${i}`}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border",
                accentClass
              )}
            >
              {tag}
              <button
                onClick={() => onRemove(i)}
                className="hover:opacity-70 transition-opacity"
                aria-label={`Remove ${tag}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          className="bp-field flex-1 text-sm"
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          onClick={() => onAdd(inputValue)}
          disabled={!inputValue.trim()}
          className={cn(
            "px-2 py-1.5 rounded-md border text-sm transition-colors",
            "hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          )}
          aria-label="Add topic"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function LearnedContextDisplay({
  learned,
  interactionCount,
  lastEvolved,
  onEvolve,
  isEvolving,
}: {
  learned: Record<string, unknown>;
  interactionCount: number;
  lastEvolved: string | null;
  onEvolve: () => void;
  isEvolving: boolean;
}) {
  const hasLearned = Object.keys(learned).length > 0 &&
    Object.values(learned).some((v) => v && (typeof v === "string" ? v.trim() : true));

  return (
    <div className="space-y-3">
      {hasLearned ? (
        <div className="space-y-2">
          {typeof learned.preferences === "string" && learned.preferences && (
            <div className="text-xs">
              <span className="text-muted-foreground font-medium">Preferences: </span>
              {String(learned.preferences)}
            </div>
          )}
          {Array.isArray(learned.patterns) && learned.patterns.length > 0 && (
            <div className="text-xs">
              <span className="text-muted-foreground font-medium">Patterns: </span>
              {(learned.patterns as string[]).join("; ")}
            </div>
          )}
          {typeof learned.working_style === "string" && learned.working_style && (
            <div className="text-xs">
              <span className="text-muted-foreground font-medium">Working style: </span>
              {String(learned.working_style)}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          No patterns learned yet. The system analyzes your feedback on AI outputs
          (approvals, rejections, revision requests) to discover your preferences
          automatically.
        </p>
      )}

      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-muted-foreground">
          {interactionCount} interaction{interactionCount !== 1 ? "s" : ""}
          {lastEvolved && ` | Last evolved: ${new Date(lastEvolved).toLocaleDateString()}`}
        </span>
        <button
          onClick={onEvolve}
          disabled={isEvolving || interactionCount < 5}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
            "border hover:bg-accent",
            "disabled:opacity-40 disabled:cursor-not-allowed"
          )}
          title={interactionCount < 5 ? "Need at least 5 interactions" : "Analyze patterns now"}
        >
          {isEvolving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {isEvolving ? "Analyzing..." : "Evolve Now"}
        </button>
      </div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/30"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white transition-transform mt-0.5",
          checked ? "translate-x-4.5 ml-0.5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}
