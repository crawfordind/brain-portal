"use client";

import { useChatContext } from "@/hooks/use-chat-context";
import { ChatSheet } from "./chat-sheet";

export function ChatProvider({ children }: { children: React.ReactNode }) {
  useChatContext();

  return (
    <>
      {children}
      <ChatSheet />
    </>
  );
}
