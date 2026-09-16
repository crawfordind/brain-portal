"use client";

import { useEffect, useState, useCallback } from "react";
import { MessageSquare, Trash2, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useChatStore, ChatContextType } from "@/lib/stores/chat-store";
import { useChat } from "@/hooks/use-chat";
import { cn } from "@/lib/utils";

interface Conversation {
  id: string;
  title: string;
  context_type: ChatContextType;
  context_id: string | null;
  message_count: number;
  updated_at: string;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr + "Z");
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const CONTEXT_LABELS: Record<string, string> = {
  executive: "Dashboard",
  project: "Project",
  note: "Note",
  task: "Tasks",
  general: "General",
};

export function ChatHistory() {
  const { conversationId, setShowHistory } = useChatStore();
  const { loadConversation, startNewChat } = useChat();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchConversations = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/chat/conversations?limit=50");
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const handleSelect = async (conv: Conversation) => {
    await loadConversation(conv.id);
    setShowHistory(false);
  };

  const handleDelete = async (e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    setDeletingId(convId);
    try {
      const res = await fetch(`/api/chat/conversations/${convId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.id !== convId));
        // If we deleted the active conversation, start fresh
        if (conversationId === convId) {
          startNewChat();
        }
      }
    } catch {
      // Silently fail
    } finally {
      setDeletingId(null);
    }
  };

  const handleNewChat = () => {
    startNewChat();
    setShowHistory(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* History header */}
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowHistory(false)}
          className="h-8 w-8"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h3 className="text-sm font-medium flex-1">Chat History</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={handleNewChat}
          className="h-7 text-xs"
        >
          New Chat
        </Button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-8 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No conversations yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Start chatting and your history will appear here
            </p>
          </div>
        ) : (
          <div className="py-1">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => handleSelect(conv)}
                className={cn(
                  "w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors",
                  "flex items-start gap-3 group",
                  conv.id === conversationId && "bg-muted/70"
                )}
              >
                <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate flex-1">
                      {conv.title || "New Chat"}
                    </p>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                      {formatRelativeTime(conv.updated_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge
                      variant="secondary"
                      className="text-[9px] h-3.5 px-1 font-normal"
                    >
                      {CONTEXT_LABELS[conv.context_type] || conv.context_type}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {conv.message_count} {conv.message_count === 1 ? "msg" : "msgs"}
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => handleDelete(e, conv.id)}
                  disabled={deletingId === conv.id}
                  className="h-7 w-7 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex-shrink-0"
                >
                  {deletingId === conv.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3 text-muted-foreground" />
                  )}
                </Button>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
