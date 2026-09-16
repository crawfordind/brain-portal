"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ThumbsUp, ThumbsDown, X, Edit2, Check, Sparkles, FileText, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import Link from "next/link";

interface TaskRecommendation {
  id: string;
  source_type: string;
  source_text: string;
  recommended_task: string;
  confidence: number;
  priority: string;
  reasoning: string | null;
  status: string;
  created_at: string;
  note_title?: string;
  note_slug?: string;
  project_name?: string;
  project_id?: string;
}

interface RecommendationCardProps {
  recommendation: TaskRecommendation;
  onAccept?: () => void;
  onReject?: () => void;
  onDismiss?: () => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  urgent: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

export function RecommendationCard({ recommendation, onAccept, onReject, onDismiss }: RecommendationCardProps) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editedTask, setEditedTask] = useState(recommendation.recommended_task);

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/tasks/recommendations/${recommendation.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback: "accepted",
          editedTask: isEditing ? editedTask : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to accept recommendation");
      }

      return response.json();
    },
    onSuccess: () => {
      toast.success("Task added successfully!");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["recommendations"] });
      onAccept?.();
    },
    onError: () => {
      toast.error("Failed to accept recommendation");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/tasks/recommendations/${recommendation.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: "rejected" }),
      });

      if (!response.ok) {
        throw new Error("Failed to reject recommendation");
      }

      return response.json();
    },
    onSuccess: () => {
      toast.success("Feedback recorded");
      queryClient.invalidateQueries({ queryKey: ["recommendations"] });
      onReject?.();
    },
    onError: () => {
      toast.error("Failed to reject recommendation");
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/tasks/recommendations/${recommendation.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to dismiss recommendation");
      }

      return response.json();
    },
    onSuccess: () => {
      toast.success("Recommendation dismissed");
      queryClient.invalidateQueries({ queryKey: ["recommendations"] });
      onDismiss?.();
    },
    onError: () => {
      toast.error("Failed to dismiss recommendation");
    },
  });

  const confidencePercent = Math.round(recommendation.confidence * 100);

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-purple-500 to-blue-500" />

      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            <Badge variant="outline" className="text-xs">
              {confidencePercent}% confident
            </Badge>
            <Badge className={PRIORITY_COLORS[recommendation.priority]}>
              {recommendation.priority}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dismissMutation.mutate()}
            disabled={dismissMutation.isPending}
            className="h-6 w-6 p-0"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {isEditing ? (
          <div className="space-y-2">
            <Input
              value={editedTask}
              onChange={(e) => setEditedTask(e.target.value)}
              className="font-medium"
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  acceptMutation.mutate();
                  setIsEditing(false);
                }}
                disabled={acceptMutation.isPending}
              >
                <Check className="h-3 w-3 mr-1" />
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditedTask(recommendation.recommended_task);
                  setIsEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-sm leading-relaxed flex-1">
                {recommendation.recommended_task}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(true)}
                className="h-6 w-6 p-0 shrink-0"
              >
                <Edit2 className="h-3 w-3" />
              </Button>
            </div>

            {recommendation.reasoning && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                {recommendation.reasoning}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1">
              {recommendation.note_title && recommendation.note_slug && (
                <Link
                  href={`/notes/${recommendation.note_slug}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Badge variant="outline" className="gap-1 hover:bg-muted cursor-pointer">
                    <FileText className="h-3 w-3" />
                    {recommendation.note_title}
                  </Badge>
                </Link>
              )}
              {recommendation.project_name && (
                <Badge variant="outline" className="gap-1">
                  <FolderOpen className="h-3 w-3" />
                  {recommendation.project_name}
                </Badge>
              )}
              <span className="text-muted-foreground">
                {format(new Date(recommendation.created_at), "MMM d, h:mm a")}
              </span>
            </div>
          </div>
        )}
      </CardContent>

      {!isEditing && (
        <CardFooter className="flex gap-2 pt-3">
          <Button
            className="flex-1"
            size="sm"
            onClick={() => acceptMutation.mutate()}
            disabled={acceptMutation.isPending || rejectMutation.isPending}
          >
            <ThumbsUp className="h-3 w-3 mr-1" />
            Accept
          </Button>
          <Button
            className="flex-1"
            size="sm"
            variant="outline"
            onClick={() => rejectMutation.mutate()}
            disabled={acceptMutation.isPending || rejectMutation.isPending}
          >
            <ThumbsDown className="h-3 w-3 mr-1" />
            Not a task
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
