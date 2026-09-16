"use client";

/**
 * NotePreviewModal - Preview note from graph view
 *
 * Shows note content preview and connected notes when clicking a graph node.
 * Provides actions to open full note or focus in graph.
 *
 * @component
 */

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Focus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ModalSection } from "@/components/modals/modal-section";
import type { GraphNode, GraphLink } from "@/app/api/graph/route";

interface NotePreviewModalProps {
  node: GraphNode | null;
  links: GraphLink[];
  allNodes: GraphNode[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFocusNode?: (nodeId: string) => void;
}

interface NoteDetail {
  id: string;
  title: string;
  content: string;
  slug: string;
  projectName: string | null;
  updatedAt: string;
}

export function NotePreviewModal({
  node,
  links,
  allNodes,
  open,
  onOpenChange,
  onFocusNode,
}: NotePreviewModalProps) {
  // Fetch full note content
  const { data: noteDetail, isLoading } = useQuery<NoteDetail>({
    queryKey: ['note', node?.id],
    queryFn: async () => {
      if (!node) throw new Error('No node selected');
      const response = await fetch(`/api/notes/${node.id}`);
      if (!response.ok) {
        throw new Error('Failed to fetch note');
      }
      return response.json();
    },
    enabled: open && !!node,
  });

  if (!node) return null;

  // Get connected notes
  const connectedLinks = links.filter(
    link => link.source === node.id || link.target === node.id
  );

  const connectedNodes = connectedLinks.map(link => {
    const targetId = link.source === node.id ? link.target : link.source;
    const targetNode = allNodes.find(n => n.id === targetId);
    return {
      node: targetNode,
      link: link,
      isSource: link.source === node.id,
    };
  }).filter(item => item.node);

  // Get content preview (first 300 chars)
  const contentPreview = noteDetail?.content
    ? noteDetail.content.substring(0, 300) + (noteDetail.content.length > 300 ? '...' : '')
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{node.title}</DialogTitle>
          <DialogDescription>
            {node.connectionCount} connection{node.connectionCount !== 1 ? 's' : ''}
            {node.projectName && ` • ${node.projectName}`}
            {node.isPinned && ' • 📌 Pinned'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Content Preview */}
          <ModalSection title="Content Preview">
            {isLoading ? (
              <div className="animate-pulse space-y-2">
                <div className="h-4 bg-muted rounded w-full" />
                <div className="h-4 bg-muted rounded w-5/6" />
                <div className="h-4 bg-muted rounded w-4/6" />
              </div>
            ) : (
              <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                {contentPreview || 'No content yet'}
              </div>
            )}
          </ModalSection>

          {/* Connected Notes */}
          {connectedNodes.length > 0 && (
            <ModalSection title="Connected Notes">
              <div className="space-y-2">
                {connectedNodes.map(({ node: connectedNode, link, isSource }) => {
                  if (!connectedNode) return null;

                  // Get connection color based on type
                  const typeColors: Record<string, string> = {
                    related: 'text-blue-500',
                    supports: 'text-green-500',
                    extends: 'text-orange-500',
                    contradicts: 'text-red-500',
                    references: 'text-purple-500',
                  };
                  const colorClass = typeColors[link.type] || 'text-muted-foreground';

                  return (
                    <button
                      key={connectedNode.id}
                      onClick={() => {
                        onFocusNode?.(connectedNode.id);
                        onOpenChange(false);
                      }}
                      className="flex items-start gap-2 p-2 rounded-lg hover:bg-muted transition-colors text-left w-full"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{connectedNode.title}</div>
                        <div className={`text-xs ${colorClass} capitalize`}>
                          {isSource ? '→' : '←'} {link.type}
                          {!link.isManual && ' (AI)'}
                          {link.reason && ` • ${link.reason}`}
                        </div>
                      </div>
                      <Focus className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    </button>
                  );
                })}
              </div>
            </ModalSection>
          )}

          {/* Metadata */}
          <ModalSection title="Details">
            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Word count:</span>
                <span>{node.wordCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Connections:</span>
                <span>{node.connectionCount}</span>
              </div>
              {noteDetail?.updatedAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last updated:</span>
                  <span>{new Date(noteDetail.updatedAt).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </ModalSection>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button
            variant="default"
            onClick={() => {
              window.location.href = `/notes/${node.slug}`;
            }}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Open Full Note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
