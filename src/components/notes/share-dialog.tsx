"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Share2, Copy, RefreshCw, X } from "lucide-react";

interface ShareDialogProps {
  noteId: string;
  slug: string;
  isShared: boolean;
  shareToken: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareDialog({
  noteId,
  slug,
  isShared: initialIsShared,
  shareToken: initialToken,
  open,
  onOpenChange,
}: ShareDialogProps) {
  const [isShared, setIsShared] = useState(initialIsShared);
  const [shareToken, setShareToken] = useState(initialToken);
  const queryClient = useQueryClient();

  // Sync state with props when they change
  useEffect(() => {
    setIsShared(initialIsShared);
    setShareToken(initialToken);
  }, [initialIsShared, initialToken]);

  const shareUrl = shareToken
    ? `${process.env.NEXT_PUBLIC_APP_URL || window.location.origin}/shared/${shareToken}`
    : "";

  // Enable sharing mutation
  const enableMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/notes/${noteId}/share`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to enable sharing");
      return response.json();
    },
    onSuccess: (data) => {
      setIsShared(true);
      setShareToken(data.token);
      queryClient.invalidateQueries({ queryKey: ["note", slug] });
      toast.success("Sharing enabled");
    },
    onError: () => {
      toast.error("Failed to enable sharing");
    },
  });

  // Revoke sharing mutation
  const revokeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/notes/${noteId}/share`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to revoke sharing");
      return response.json();
    },
    onSuccess: () => {
      setIsShared(false);
      setShareToken(null);
      queryClient.invalidateQueries({ queryKey: ["note", slug] });
      toast.success("Sharing disabled");
      onOpenChange(false);
    },
    onError: () => {
      toast.error("Failed to revoke sharing");
    },
  });

  // Regenerate token mutation
  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/notes/${noteId}/share`, {
        method: "PUT",
      });
      if (!response.ok) throw new Error("Failed to regenerate link");
      return response.json();
    },
    onSuccess: (data) => {
      setShareToken(data.token);
      queryClient.invalidateQueries({ queryKey: ["note", slug] });
      toast.success("Link regenerated");
    },
    onError: () => {
      toast.error("Failed to regenerate link");
    },
  });

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Failed to copy link");
    }
  };

  const isLoading =
    enableMutation.isPending ||
    revokeMutation.isPending ||
    regenerateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Note</DialogTitle>
          <DialogDescription>
            {isShared
              ? "This note is publicly accessible via the link below."
              : "Generate a public link to share this note with anyone."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isShared ? (
            <Button
              onClick={() => enableMutation.mutate()}
              disabled={isLoading}
              className="w-full"
            >
              <Share2 className="h-4 w-4 mr-2" />
              Share this note
            </Button>
          ) : (
            <>
              <div className="flex gap-2">
                <Input
                  value={shareUrl}
                  readOnly
                  className="font-mono text-sm"
                  onClick={(e) => e.currentTarget.select()}
                />
                <Button
                  onClick={copyToClipboard}
                  variant="secondary"
                  size="icon"
                  disabled={isLoading}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => regenerateMutation.mutate()}
                  variant="outline"
                  disabled={isLoading}
                  className="flex-1"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Regenerate Link
                </Button>
                <Button
                  onClick={() => revokeMutation.mutate()}
                  variant="destructive"
                  disabled={isLoading}
                  className="flex-1"
                >
                  <X className="h-4 w-4 mr-2" />
                  Stop Sharing
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Regenerating the link will invalidate the old link immediately.
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
