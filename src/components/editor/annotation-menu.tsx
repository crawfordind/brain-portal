'use client';

/**
 * Highlight-to-instruct controls.
 *
 * Two entry points onto the same command set: a toolbar dropdown (works on
 * mobile, discoverable, spells out what each colour means) and a bubble menu
 * that appears over a text selection (fast, for people who already know the
 * palette). Both are deliberately labelled by *meaning* rather than colour —
 * "Expand", not "blue" — because the meaning is what the reviewing model acts
 * on.
 */

import { useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Highlighter, Eraser, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { ANNOTATION_INTENTS, type AnnotationIntentId } from '@/lib/annotations/intents';
import { cn } from '@/lib/utils';

/** "Mod-Alt-3" → "⌘⌥3" on Mac, "Ctrl+Alt+3" elsewhere. */
function formatShortcut(shortcut: string): string {
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
  const key = shortcut.split('-').pop() ?? '';
  return isMac ? `⌘⌥${key}` : `Ctrl+Alt+${key}`;
}

function useAnnotationActions(editor: Editor) {
  const apply = useCallback(
    (intent: AnnotationIntentId) => {
      editor.chain().focus().toggleAnnotation(intent).run();
    },
    [editor]
  );

  const clear = useCallback(() => {
    editor.chain().focus().unsetAnnotation().run();
  }, [editor]);

  const comment = useCallback(() => {
    const existing = (editor.getAttributes('annotation').comment as string | null) ?? '';
    const next = window.prompt('Note for the AI about this highlight', existing);
    if (next === null) return;
    editor.chain().focus().setAnnotationComment(next.trim() || null).run();
  }, [editor]);

  return { apply, clear, comment };
}

interface AnnotationMenuProps {
  editor: Editor;
}

/**
 * Toolbar dropdown: the discoverable path. Each row states what the colour
 * tells the AI, so the palette needs no separate legend.
 */
export function AnnotationToolbarButton({ editor }: AnnotationMenuProps) {
  const { apply, clear, comment } = useAnnotationActions(editor);
  const isHighlighted = editor.isActive('annotation');

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'h-10 w-10 p-0 md:h-8 md:w-8 shrink-0',
                isHighlighted && 'bg-muted text-foreground'
              )}
            >
              <Highlighter className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Highlight to tell the AI what to do</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Highlight a passage to say what you want done with it. Any AI that
          reviews this note reads the colours as instructions.
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {ANNOTATION_INTENTS.map((intent) => (
          <DropdownMenuItem
            key={intent.id}
            onSelect={() => apply(intent.id)}
            className="gap-2.5 items-start py-2"
          >
            <span
              aria-hidden
              className="mt-1 h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: intent.swatch }}
            />
            <span className="flex-1 min-w-0">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{intent.label}</span>
                <kbd className="text-[10px] opacity-50">{formatShortcut(intent.shortcut)}</kbd>
              </span>
              <span className="block text-xs text-muted-foreground">{intent.meaning}</span>
            </span>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={comment} disabled={!isHighlighted} className="gap-2.5">
          <MessageSquarePlus className="h-4 w-4 shrink-0" />
          Add a note to this highlight
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={clear} disabled={!isHighlighted} className="gap-2.5">
          <Eraser className="h-4 w-4 shrink-0" />
          Remove highlight
          <kbd className="ml-auto text-[10px] opacity-50">{formatShortcut('Mod-Alt-0')}</kbd>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Selection bubble: the fast path. Swatches only — the tooltip carries the
 * meaning, and the toolbar dropdown is there for anyone who wants it spelled out.
 */
export function AnnotationBubbleMenu({ editor }: AnnotationMenuProps) {
  const { apply, clear, comment } = useAnnotationActions(editor);

  return (
    <BubbleMenu
      editor={editor}
      updateDelay={100}
      shouldShow={({ editor: e, state }) => {
        if (!e.isEditable) return false;
        // The image menu owns figure selections.
        if (e.isActive('figure')) return false;
        return !state.selection.empty;
      }}
    >
      <div className="flex items-center gap-0.5 bg-background border rounded-lg shadow-lg p-1">
        {ANNOTATION_INTENTS.map((intent) => (
          <Tooltip key={intent.id}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`${intent.label}: ${intent.meaning}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  apply(intent.id);
                }}
                className={cn(
                  'h-8 w-8 p-0',
                  editor.isActive('annotation', { intent: intent.id }) && 'ring-1 ring-ring'
                )}
              >
                <span
                  aria-hidden
                  className="h-4 w-4 rounded-sm border border-black/10"
                  style={{ backgroundColor: intent.swatch }}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <span className="font-medium">{intent.label}</span>
              <span className="ml-1 opacity-70">{intent.meaning}</span>
            </TooltipContent>
          </Tooltip>
        ))}

        <Separator orientation="vertical" className="h-6 mx-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Add a note to this highlight"
              disabled={!editor.isActive('annotation')}
              onMouseDown={(e) => {
                e.preventDefault();
                comment();
              }}
              className="h-8 w-8 p-0"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Add a note for the AI</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Remove highlight"
              disabled={!editor.isActive('annotation')}
              onMouseDown={(e) => {
                e.preventDefault();
                clear();
              }}
              className="h-8 w-8 p-0"
            >
              <Eraser className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove highlight</TooltipContent>
        </Tooltip>
      </div>
    </BubbleMenu>
  );
}
