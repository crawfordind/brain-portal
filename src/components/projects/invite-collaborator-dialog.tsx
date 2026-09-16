"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Send } from "lucide-react";
import { toast } from "sonner";

interface InviteCollaboratorDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InviteCollaboratorDialog({
  projectId,
  open,
  onOpenChange,
}: InviteCollaboratorDialogProps) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to send invite");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["project-collaborators", projectId],
      });
      toast.success(data.isResend ? "Invite resent" : "Invitation sent");
      setEmail("");
      setRole("viewer");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite Collaborator</DialogTitle>
          <DialogDescription>
            Send an email invitation to collaborate on this project.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email address</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="collaborator@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-11 md:min-h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "viewer" | "editor")}>
              <SelectTrigger id="invite-role" className="min-h-11 md:min-h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer - can browse, cannot edit</SelectItem>
                <SelectItem value="editor">Editor - can edit content</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => inviteMutation.mutate()}
            disabled={!email.trim() || inviteMutation.isPending}
            className="w-full min-h-11 md:min-h-9"
          >
            <Send className="h-4 w-4 mr-2" />
            {inviteMutation.isPending ? "Sending..." : "Send Invitation"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
