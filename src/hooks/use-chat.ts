"use client";

import { useCallback } from "react";
import { useChatStore, ChatMessageItem, ChatContextType, ChatItemSubject } from "@/lib/stores/chat-store";
import { CONTEXT_LABELS } from "@/lib/chat/prompts";
import { parseItemRef } from "@/lib/chat/item-types";

export function useChat() {
  const {
    conversationId,
    contextType,
    contextId,
    isStreaming,
    setStreaming,
    addMessage,
    updateStreamingMessage,
    finalizeStreamingMessage,
    setConversationId,
    setError,
    reset,
  } = useChatStore();

  const sendMessage = useCallback(
    async (content: string) => {
      if (isStreaming) return;

      setError(null);
      setStreaming(true);

      // Add user message to store
      const userMsg: ChatMessageItem = {
        id: `user-${Date.now()}`,
        role: "user",
        content,
        created_at: new Date().toISOString(),
      };
      addMessage(userMsg);

      // Add placeholder streaming message
      const streamingMsg: ChatMessageItem = {
        id: `streaming-${Date.now()}`,
        role: "assistant",
        content: "",
        isStreaming: true,
        created_at: new Date().toISOString(),
      };
      addMessage(streamingMsg);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            message: content,
            contextType,
            contextId,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          throw new Error(err.error || `HTTP ${res.status}`);
        }

        // Capture conversation ID from header
        const newConvId = res.headers.get("X-Conversation-Id");
        if (newConvId && !conversationId) {
          setConversationId(newConvId);
        }

        // Read SSE stream
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value);
          for (const line of text.split("\n")) {
            if (line === "data: [DONE]") {
              continue;
            }
            if (line.startsWith("data: ")) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.error) {
                  throw new Error(parsed.error);
                }
                if (parsed.content) {
                  fullContent += parsed.content;
                  updateStreamingMessage(fullContent);
                }
              } catch (e) {
                if (e instanceof SyntaxError) continue;
                throw e;
              }
            }
          }
        }

        finalizeStreamingMessage(`assistant-${Date.now()}`, fullContent);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to send message";
        setError(message);
        setStreaming(false);
        // Remove the streaming placeholder on error
        finalizeStreamingMessage(`error-${Date.now()}`, "Sorry, something went wrong. Please try again.");
      }
    },
    [
      conversationId,
      contextType,
      contextId,
      isStreaming,
      setStreaming,
      addMessage,
      updateStreamingMessage,
      finalizeStreamingMessage,
      setConversationId,
      setError,
    ]
  );

  const loadConversation = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/chat/conversations/${id}`);
        if (!res.ok) return;

        const data = await res.json();
        const conv = data.conversation;
        const messages = data.messages
          .filter((m: { role: string }) => m.role !== "system")
          .map((m: { id: string; role: string; content: string; created_at: string }) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            created_at: m.created_at,
          }));

        // Restore full state from loaded conversation in one batch
        const ctxType = (conv?.context_type || "general") as ChatContextType;
        const ctxId = conv?.context_id || null;

        // Reopening a chat that was pinned to an item re-pins it, so the
        // header still names the item and a saved answer still links back to
        // it. Without this the conversation would come back as a generic chat
        // that merely happens to have the item in its system prompt.
        const ref = ctxType === "item" ? parseItemRef(ctxId) : null;
        const itemSubject: ChatItemSubject | null = ref
          ? { type: ref.type, id: ref.id, title: conv?.title || "This item" }
          : null;

        useChatStore.setState({
          conversationId: id,
          messages,
          contextType: ctxType,
          contextId: ctxId,
          contextLabel: itemSubject ? itemSubject.title : CONTEXT_LABELS[ctxType] || "General",
          itemSubject,
          error: null,
        });
      } catch {
        setError("Failed to load conversation");
      }
    },
    [setError]
  );

  const startNewChat = useCallback(() => {
    reset();
  }, [reset]);

  return { sendMessage, loadConversation, startNewChat };
}
