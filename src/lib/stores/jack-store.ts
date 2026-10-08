import { create } from "zustand";

/**
 * What "Send to Jack" was opened on. Ids are hints for the server, which
 * checks every one of them against the signed-in user before using it.
 */
export interface JackTarget {
  sourceType: string;
  sourceId: string;
  title: string;
  projectId?: string | null;
}

interface JackDialogStore {
  target: JackTarget | null;
  open: (target: JackTarget) => void;
  close: () => void;
}

export const useJackDialogStore = create<JackDialogStore>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));
