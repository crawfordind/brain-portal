import { create } from "zustand";

/**
 * What the "Send to agent" dialog was opened on. Ids are hints for the server, which
 * checks every one of them against the signed-in user before using it.
 */
export interface AgentTarget {
  sourceType: string;
  sourceId: string;
  title: string;
  projectId?: string | null;
}

interface AgentDialogStore {
  target: AgentTarget | null;
  open: (target: AgentTarget) => void;
  close: () => void;
}

export const useAgentDialogStore = create<AgentDialogStore>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));
