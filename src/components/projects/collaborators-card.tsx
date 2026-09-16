"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserPlus, RotateCw, X, Crown } from "lucide-react";
import { toast } from "sonner";
import { InviteCollaboratorDialog } from "./invite-collaborator-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface Collaborator {
  id: string;
  project_id: string;
  user_id: string | null;
  email: string;
  role: "editor" | "viewer";
  status: "pending" | "accepted";
  display_name: string | null;
  created_at: string;
}

interface Owner {
  id: string;
  email: string;
  display_name: string | null;
}

interface CollaboratorsCardProps {
  projectId: string;
}

export function CollaboratorsCard({ projectId }: CollaboratorsCardProps) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [isInviteOpen, setIsInviteOpen] = useState(false);

  const { data, isLoading } = useQuery<{
    collaborators: Collaborator[];
    owner: Owner;
  }>({
    queryKey: ["project-collaborators", projectId],
    queryFn: async () => {
      const response = await fetch(
        `/api/projects/${projectId}/collaborators`
      );
      if (!response.ok) throw new Error("Failed to fetch collaborators");
      return response.json();
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({
      collaboratorId,
      role,
    }: {
      collaboratorId: string;
      role: string;
    }) => {
      const response = await fetch(
        `/api/projects/${projectId}/collaborators/${collaboratorId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        }
      );
      if (!response.ok) throw new Error("Failed to update role");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["project-collaborators", projectId],
      });
      toast.success("Role updated");
    },
    onError: () => toast.error("Failed to update role"),
  });

  const removeMutation = useMutation({
    mutationFn: async (collaboratorId: string) => {
      const response = await fetch(
        `/api/projects/${projectId}/collaborators/${collaboratorId}`,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error("Failed to remove");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["project-collaborators", projectId],
      });
      toast.success("Collaborator removed");
    },
    onError: () => toast.error("Failed to remove collaborator"),
  });

  const resendMutation = useMutation({
    mutationFn: async (collaboratorId: string) => {
      const response = await fetch(
        `/api/projects/${projectId}/collaborators/${collaboratorId}/resend`,
        { method: "POST" }
      );
      if (!response.ok) throw new Error("Failed to resend");
      return response.json();
    },
    onSuccess: () => {
      toast.success("Invite resent");
    },
    onError: () => toast.error("Failed to resend invite"),
  });

  const collaborators = data?.collaborators || [];
  const owner = data?.owner;

  return (
    <div className="space-y-3">
      {/* Invite button */}
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => setIsInviteOpen(true)}
          className="min-h-9"
        >
          <UserPlus className="h-4 w-4 mr-1" />
          Invite
        </Button>
      </div>

      {/* Owner row */}
      {owner && (
        <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30 min-h-14">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">
                {owner.display_name || owner.email}
              </span>
              <Badge variant="secondary" className="text-xs shrink-0">
                <Crown className="h-3 w-3 mr-1" />
                Owner
              </Badge>
            </div>
            {owner.display_name && (
              <p className="text-xs text-muted-foreground truncate">
                {owner.email}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Collaborator list */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          Loading...
        </p>
      ) : collaborators.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No collaborators yet. Invite someone to share this project.
        </p>
      ) : (
        <div className="space-y-2">
          {collaborators.map((collab) => (
            <div
              key={collab.id}
              className="flex items-center gap-3 p-3 rounded-lg border min-h-14"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">
                    {collab.display_name || collab.email}
                  </span>
                  {collab.status === "pending" && (
                    <Badge
                      variant="outline"
                      className="text-[10px] text-yellow-600 border-yellow-500/20 shrink-0"
                    >
                      Pending
                    </Badge>
                  )}
                </div>
                {collab.display_name && (
                  <p className="text-xs text-muted-foreground truncate">
                    {collab.email}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* Role selector */}
                <Select
                  value={collab.role}
                  onValueChange={(role) =>
                    updateRoleMutation.mutate({
                      collaboratorId: collab.id,
                      role,
                    })
                  }
                >
                  <SelectTrigger className="w-24 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="editor">Editor</SelectItem>
                  </SelectContent>
                </Select>

                {/* Resend invite (pending only) */}
                {collab.status === "pending" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => resendMutation.mutate(collab.id)}
                    disabled={resendMutation.isPending}
                    title="Resend invite"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                  </Button>
                )}

                {/* Remove */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    const isPending = collab.status === "pending";
                    const ok = await confirm({
                      title: isPending ? "Revoke this invite?" : "Remove this collaborator?",
                      description: isPending ? "The invite link will no longer work." : "They will lose access to this project.",
                      destructive: true,
                      confirmLabel: isPending ? "Revoke" : "Remove",
                    });
                    if (ok) removeMutation.mutate(collab.id);
                  }}
                  title={
                    collab.status === "pending" ? "Revoke invite" : "Remove"
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <InviteCollaboratorDialog
        projectId={projectId}
        open={isInviteOpen}
        onOpenChange={setIsInviteOpen}
      />
    </div>
  );
}
