"use client";

import { useMemo, useState } from "react";
import { marked } from "marked";
import { toast } from "sonner";
import { FileText, ListTodo, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { sanitizeHtml } from "@/lib/sanitize";
import { AgentAvatar } from "./agent-avatar";
import { useChatStore } from "@/lib/stores/chat-store";
import type { ChatMessageItem } from "@/lib/stores/chat-store";

interface ChatMessageProps {
  message: ChatMessageItem;
  contextType: string;
}

export function ChatMessage({ message, contextType }: ChatMessageProps) {
  const isUser = message.role === "user";
  const itemSubject = useChatStore((s) => s.itemSubject);
  const [saving, setSaving] = useState<"note" | "task" | null>(null);
  const [saved, setSaved] = useState<"note" | "task" | null>(null);

  /*
   * The one button the review screen actually needed. Approving, revising and
   * rejecting all have conversational equivalents; keeping the answer does
   * not, so it is the only action that survives as a button.
   */
  const save = async (as: "note" | "task") => {
    if (saving) return;
    setSaving(as);
    try {
      const res = await fetch("/api/chat/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: message.content,
          as,
          sourceType: itemSubject?.type ?? null,
          sourceId: itemSubject?.id ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");

      setSaved(as);
      toast.success(
        as === "note" ? "Saved as note" : "Saved as task",
        data.saved === "note" && data.slug
          ? { action: { label: "Open", onClick: () => window.open(`/notes/${data.slug}`, "_blank") } }
          : undefined
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(null);
    }
  };

  const canSave = !isUser && !message.isStreaming && message.content.trim().length > 0;

  const assistantHtml = useMemo(() => {
    if (isUser || !message.content) return "";
    try {
      marked.setOptions({ breaks: true, gfm: true });
      marked.use({
        renderer: {
          link(token: { href: string; title?: string | null; text: string }) {
            const titleAttr = token.title ? ` title="${token.title}"` : "";
            return `<a href="${token.href}"${titleAttr} target="_blank" rel="noopener noreferrer">${token.text}</a>`;
          },
        },
      });
      const result = marked.parse(message.content);
      return typeof result === "string" ? sanitizeHtml(result) : message.content;
    } catch {
      return message.content;
    }
  }, [isUser, message.content]);

  return (
    <div
      className={cn(
        "flex gap-2 px-4 py-2",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <AgentAvatar contextType={contextType} size="sm" className="mt-1 flex-shrink-0" />
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        )}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap break-words">
            {message.content}
          </div>
        ) : message.content ? (
          <div className="relative">
            <div
              className="prose max-w-none break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              dangerouslySetInnerHTML={{ __html: assistantHtml }}
            />
            {message.isStreaming && (
              <span className="inline-block h-3.5 w-0.5 ml-0.5 animate-pulse bg-current align-middle" />
            )}
            {canSave && (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/50 pt-2">
                <SaveButton
                  icon={FileText}
                  label="Save as note"
                  active={saved === "note"}
                  busy={saving === "note"}
                  disabled={saving !== null}
                  onClick={() => save("note")}
                />
                <SaveButton
                  icon={ListTodo}
                  label="Save as task"
                  active={saved === "task"}
                  busy={saving === "task"}
                  disabled={saving !== null}
                  onClick={() => save("task")}
                />
              </div>
            )}
          </div>
        ) : message.isStreaming ? (
          <span className="inline-block h-4 w-1 animate-pulse bg-current" />
        ) : null}
      </div>
    </div>
  );
}

function SaveButton({
  icon: Icon,
  label,
  active,
  busy,
  disabled,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  active: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
        "text-muted-foreground hover:bg-background hover:text-foreground",
        "disabled:pointer-events-none",
        active && "text-foreground"
      )}
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : active ? (
        <Check className="h-3 w-3" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      {active ? "Saved" : label}
    </button>
  );
}
