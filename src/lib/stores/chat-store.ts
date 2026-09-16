import { create } from "zustand";

export interface ChatMessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  created_at: string;
}

export type ChatContextType = "executive" | "project" | "note" | "task" | "item" | "general";

/** The item a chat is pinned to, when it is pinned to one. */
export interface ChatItemSubject {
  type: string;
  id: string;
  title: string;
}

export interface ChatStore {
  isOpen: boolean;
  showHistory: boolean;
  conversationId: string | null;
  messages: ChatMessageItem[];
  isStreaming: boolean;
  error: string | null;
  contextType: ChatContextType;
  contextId: string | null;
  contextLabel: string;
  /** Set only while the chat is pinned to one item. Drives the empty state. */
  itemSubject: ChatItemSubject | null;
  /**
   * The context the current route implies, kept up to date independently of
   * the active context. Pinning to an item overrides the route; starting a
   * new chat falls back to this rather than leaving the previous item pinned.
   */
  routeContext: { type: ChatContextType; id: string | null; label: string };

  openChat: () => void;
  closeChat: () => void;
  toggleHistory: () => void;
  setShowHistory: (v: boolean) => void;
  setContext: (type: ChatContextType, id: string | null, label: string) => void;
  /** Pin the chat to a single item and open it. */
  askAboutItem: (subject: ChatItemSubject) => void;
  addMessage: (msg: ChatMessageItem) => void;
  updateStreamingMessage: (content: string) => void;
  finalizeStreamingMessage: (id: string, content: string) => void;
  setStreaming: (v: boolean) => void;
  setError: (e: string | null) => void;
  setConversationId: (id: string | null) => void;
  setMessages: (messages: ChatMessageItem[]) => void;
  reset: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  isOpen: false,
  showHistory: false,
  conversationId: null,
  messages: [],
  isStreaming: false,
  error: null,
  contextType: "general",
  contextId: null,
  contextLabel: "General",
  itemSubject: null,
  routeContext: { type: "general", id: null, label: "General" },

  openChat: () => set({ isOpen: true }),
  closeChat: () => set({ isOpen: false, showHistory: false }),
  toggleHistory: () => set((state) => ({ showHistory: !state.showHistory })),
  setShowHistory: (v) => set({ showHistory: v }),

  setContext: (type, id, label) => {
    const state = get();
    // The route's own context is recorded either way, so a later "new chat"
    // lands back on the page the user is actually looking at.
    const routeContext = { type, id, label };

    // Only reset the conversation if the context actually changed. Pinning to
    // an item counts as a change, so navigating away unpins it.
    if (state.contextType !== type || state.contextId !== id) {
      set({
        routeContext,
        contextType: type,
        contextId: id,
        contextLabel: label,
        itemSubject: null,
        conversationId: null,
        messages: [],
        error: null,
      });
      return;
    }

    set({ routeContext });
  },

  askAboutItem: (subject) => {
    const contextId = `${subject.type}:${subject.id}`;
    const state = get();

    // Re-opening the same item keeps the conversation so far — the natural
    // reading of asking about it again is "carry on", not "start over".
    if (state.contextType === "item" && state.contextId === contextId) {
      set({ itemSubject: subject, isOpen: true, showHistory: false, error: null });
      return;
    }

    set({
      contextType: "item",
      contextId,
      contextLabel: subject.title,
      itemSubject: subject,
      conversationId: null,
      messages: [],
      error: null,
      isOpen: true,
      showHistory: false,
    });
  },

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  updateStreamingMessage: (content) =>
    set((state) => {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last && last.isStreaming) {
        messages[messages.length - 1] = { ...last, content };
      }
      return { messages };
    }),

  finalizeStreamingMessage: (id, content) =>
    set((state) => {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last && last.isStreaming) {
        messages[messages.length - 1] = {
          ...last,
          id,
          content,
          isStreaming: false,
        };
      }
      return { messages, isStreaming: false };
    }),

  setStreaming: (v) => set({ isStreaming: v }),
  setError: (e) => set({ error: e }),
  setConversationId: (id) => set({ conversationId: id }),
  setMessages: (messages) => set({ messages }),

  // "New chat" also drops any pinned item and returns to the route's context,
  // so the fresh conversation is about where the user is, not where they were.
  reset: () =>
    set((state) => ({
      conversationId: null,
      messages: [],
      isStreaming: false,
      error: null,
      itemSubject: null,
      contextType: state.routeContext.type,
      contextId: state.routeContext.id,
      contextLabel: state.routeContext.label,
    })),
}));
