"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Attachment } from "@/lib/db/schema";
import { deleteAttachmentRequest } from "@/lib/attachments/upload-client";

/**
 * Confirm, then delete an attachment on the server. Resolves true only once
 * the server has removed it, so a caller drops it from its list only then.
 *
 * The viewer's Delete button used to call a parent callback that just
 * filtered the file out of local state: it vanished from the screen and came
 * back on the next load.
 */
export function useDeleteAttachment() {
  const confirm = useConfirm();

  return useCallback(
    async (attachment: Pick<Attachment, "id" | "note_id" | "filename">): Promise<boolean> => {
      const ok = await confirm({
        title: `Delete "${attachment.filename}"?`,
        description: "This file will be permanently removed.",
        destructive: true,
        confirmLabel: "Delete",
      });
      if (!ok) return false;

      try {
        await deleteAttachmentRequest(attachment);
        toast.success("Attachment deleted");
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to delete attachment");
        return false;
      }
    },
    [confirm]
  );
}
