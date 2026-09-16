import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

interface BulkActionToolbarProps {
  selectedCount: number;
  onDelete: () => void;
  onCancel: () => void;
  isDeleting?: boolean;
}

/**
 * Floating toolbar that appears when items are selected
 * Provides bulk actions like delete
 */
export function BulkActionToolbar({
  selectedCount,
  onDelete,
  onCancel,
  isDeleting = false,
}: BulkActionToolbarProps) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-background border rounded-lg shadow-lg p-4 animate-in slide-in-from-bottom-5">
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium">
          {selectedCount} selected
        </span>
        <Button
          variant="destructive"
          size="sm"
          onClick={onDelete}
          disabled={isDeleting}
          className="min-h-9"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          {isDeleting ? "Deleting..." : "Delete"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="min-h-9"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
