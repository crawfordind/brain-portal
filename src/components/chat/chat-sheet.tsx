"use client";

import { useRef, useEffect } from "react";
import { MessageSquarePlus, History } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useChatStore } from "@/lib/stores/chat-store";
import { useChat } from "@/hooks/use-chat";
import { AGENT_NAMES } from "@/lib/chat/prompts";
import { AgentAvatar } from "./agent-avatar";
import { ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import { ChatHistory } from "./chat-history";
import { getItemSuggestions } from "@/lib/chat/item-suggestions";
import type { ChatItemType } from "@/lib/chat/item-types";

/** How each pinned item type is named in the header badge. */
const ITEM_BADGES: Record<string, string> = {
  note: "Note",
  journal: "Journal",
  capture: "Thought",
  thought: "Thought",
  task: "Task",
  reminder: "Reminder",
  insight: "Insight",
};

export function ChatSheet() {
  const {
    isOpen,
    showHistory,
    closeChat,
    toggleHistory,
    messages,
    isStreaming,
    error,
    contextType,
    contextLabel,
    itemSubject,
  } = useChatStore();
  const { sendMessage, startNewChat } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  const agentName = AGENT_NAMES[contextType] || "Assistant";

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && closeChat()}>
      <SheetContent
        side="bottom"
        className="z-[101] h-[85vh] flex flex-col p-0"
        overlayClassName="z-[100]"
      >
        {showHistory ? (
          <ChatHistory />
        ) : (
          <>
            {/* Header */}
            <SheetHeader className="flex-row items-center gap-3 border-b px-4 py-3 space-y-0">
              <AgentAvatar contextType={contextType} size="md" />
              <div className="flex-1 min-w-0">
                <SheetTitle className="text-sm truncate">
                  {itemSubject ? itemSubject.title : agentName}
                </SheetTitle>
                <SheetDescription className="text-xs">
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                    {itemSubject ? ITEM_BADGES[itemSubject.type] ?? "Item" : contextLabel}
                  </Badge>
                </SheetDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleHistory}
                className="h-8 w-8"
                title="Chat history"
              >
                <History className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={startNewChat}
                className="h-8 w-8"
                title="New chat"
              >
                <MessageSquarePlus className="h-4 w-4" />
              </Button>
            </SheetHeader>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
              {messages.length === 0 && (
                itemSubject ? (
                  /*
                   * Pinned to one item: name it, then offer openers. The chips
                   * are the fast path that the delegate dialog's prefilled
                   * instruction blob used to occupy, minus the editing.
                   */
                  <div className="flex flex-col justify-center h-full px-6">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Asking about
                    </p>
                    <p className="mt-1 text-sm font-medium line-clamp-2">
                      {itemSubject.title}
                    </p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Pick a starting point, or just type what you need.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {getItemSuggestions(itemSubject.type as ChatItemType).map((s) => (
                        <button
                          key={s.label}
                          type="button"
                          onClick={() => sendMessage(s.prompt)}
                          disabled={isStreaming}
                          className="rounded-full border px-3 py-2 text-xs transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-50"
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center px-8">
                    <AgentAvatar contextType={contextType} size="lg" className="mb-3" />
                    <p className="text-sm font-medium">{agentName}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Ask me anything about your {contextLabel.toLowerCase()}
                    </p>
                  </div>
                )
              )}
              {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} contextType={contextType} />
              ))}
              {error && (
                <div className="px-4 py-2">
                  <p className="text-xs text-destructive">{error}</p>
                </div>
              )}
            </div>

            {/* Input */}
            <ChatInput
              onSend={sendMessage}
              disabled={isStreaming}
              autoFocus={isOpen}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
