import { AgenticLayout } from "@/components/layout/agentic-layout";
import { VoiceProvider } from "@/components/voice";
import { ChatProvider } from "@/components/chat/chat-provider";

/**
 * Dashboard Layout - Agentic Workflow
 *
 * Uses the new AgenticLayout which features:
 * - Streamlined sidebar with Stream, Notes, Spaces, Work
 * - Brain Bar as the primary input mechanism
 * - Mobile: Bottom nav with Think button (center)
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <VoiceProvider showFAB={true} showOnboarding={true}>
      <ChatProvider>
        <AgenticLayout>{children}</AgenticLayout>
      </ChatProvider>
    </VoiceProvider>
  );
}
