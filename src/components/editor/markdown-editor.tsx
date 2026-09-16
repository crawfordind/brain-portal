"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { useEffect, useCallback, useState, useMemo } from "react";
import { smartConvertToHtml, isMarkdown } from "@/lib/markdown/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Minus,
  Heading1,
  Heading2,
  Heading3,
  Link as LinkIcon,
  Undo,
  Redo,
  Paperclip,
  Table as TableIcon,
  PenTool,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Figure } from './extensions/figure';
import { CenteredCursor } from './extensions/centered-cursor';
import { Annotation } from './extensions/annotation';
import { ImageFloatingMenu } from './image-floating-menu';
import { AnnotationToolbarButton, AnnotationBubbleMenu } from './annotation-menu';
import { AttachmentPicker } from '@/components/attachments/attachment-picker';
import type { Attachment } from '@/lib/db/schema';
import { EditorVoiceButton } from '@/components/voice/editor-voice-button';
import { SketchDialog, type SketchResult } from '@/components/sketch/sketch-dialog';

// Check if HTML clipboard content has real formatting (not just wrapper tags)
function hasRichHtml(html: string): boolean {
  if (!html) return false;
  // Strip meta/span wrappers that browsers add — check for actual formatting tags
  const stripped = html.replace(/<meta[^>]*>/gi, "").replace(/<\/?span[^>]*>/gi, "").trim();
  return /<(p|h[1-6]|ul|ol|li|pre|code|blockquote|table|strong|em|a|br)\b/i.test(stripped);
}

// Custom extension to handle markdown paste
const MarkdownPaste = Extension.create({
  name: "markdownPaste",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("markdownPaste"),
        props: {
          handlePaste: (view, event) => {
            const clipboardData = event.clipboardData;
            if (!clipboardData) return false;

            const text = clipboardData.getData("text/plain");
            const clipHtml = clipboardData.getData("text/html");

            // If clipboard has rich HTML (e.g. from ChatGPT/Claude web),
            // let TipTap's built-in handler use it — it's already formatted
            if (clipHtml && hasRichHtml(clipHtml)) return false;

            // Plain text paste with markdown — convert it
            if (!text || !isMarkdown(text)) return false;

            // Convert markdown to HTML
            const html = smartConvertToHtml(text);

            // Create a temporary container
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = html;

            // Parse HTML using ProseMirror's DOMParser
            const parser = ProseMirrorDOMParser.fromSchema(view.state.schema);
            const slice = parser.parseSlice(tempDiv);

            // Insert the parsed content
            const tr = view.state.tr.replaceSelection(slice);
            view.dispatch(tr);

            event.preventDefault();
            return true;
          },
        },
      }),
    ];
  },
});

interface MarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  editable?: boolean;
  className?: string;
  projectId?: string | null;
  noteId?: string | null;
}

export function MarkdownEditor({
  content,
  onChange,
  placeholder = "Start writing...",
  autoFocus = false,
  editable = true,
  className,
  projectId,
  noteId,
}: MarkdownEditorProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);
  const [showSketch, setShowSketch] = useState(false);

  // Convert markdown to HTML for initial content
  const initialContent = useMemo(() => smartConvertToHtml(content), [content]);

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
      Placeholder.configure({ placeholder }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-primary underline" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({
        resizable: true,
        HTMLAttributes: { class: "table-node" },
      }),
      TableRow,
      TableHeader,
      TableCell,
      MarkdownPaste,
      Figure,
      CenteredCursor,
      Annotation,
    ],
    content: initialContent,
    autofocus: autoFocus,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-slate dark:prose-invert max-w-none",
          "prose-headings:font-semibold prose-headings:tracking-tight",
          "prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg",
          "prose-p:leading-7 prose-p:my-2",
          "prose-ul:my-2 prose-ol:my-2 prose-li:my-0",
          "prose-blockquote:border-l-primary prose-blockquote:not-italic",
          "prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm",
          "prose-pre:bg-muted prose-pre:border",
          "focus:outline-none min-h-[300px] px-4 py-3",
          // Ruled-paper styling; inert below the desktop breakpoint (globals.css)
          "bp-notebook-page"
        ),
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!editor) return;

    // Convert markdown to HTML if needed
    const htmlContent = smartConvertToHtml(content);

    // Only update if content has actually changed
    if (htmlContent === editor.getHTML()) return;

    // Store current cursor position
    const { from, to } = editor.state.selection;

    // Update content
    editor.commands.setContent(htmlContent, {
      emitUpdate: false,
      parseOptions: {
        preserveWhitespace: "full"
      }
    });

    // Restore cursor position (within valid range)
    const docSize = editor.state.doc.content.size;
    const safeFrom = Math.min(from, docSize);
    const safeTo = Math.min(to, docSize);

    editor.commands.setTextSelection({ from: safeFrom, to: safeTo });
  }, [content, editor]);

  const setLink = useCallback(() => {
    if (!editor) return;

    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("URL", previousUrl);

    if (url === null) return;

    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  const handleInsertAttachments = useCallback((attachments: Attachment[]) => {
    if (!editor) return;

    attachments.forEach((attachment) => {
      if (attachment.file_type === 'image') {
        // Insert as figure with caption
        editor.commands.setFigure({
          src: attachment.storage_url,
          alt: attachment.description || attachment.filename,
          title: attachment.filename,
          caption: '',
        });
      } else {
        // Insert as link
        editor.commands.insertContent(
          `<a href="${attachment.storage_url}">${attachment.filename}</a> `
        );
      }
    });
  }, [editor]);

  const handleSketchComplete = useCallback((result: SketchResult) => {
    if (!editor) return;
    const { attachment, recognition, insertTranscription } = result;

    if (attachment) {
      editor.commands.setFigure({
        src: attachment.storage_url,
        alt: recognition?.text || recognition?.description || 'Sketch',
        title: attachment.filename,
        caption: '',
      });
    }

    // Optionally drop the transcribed handwriting in as editable text,
    // preserving any structure (lists, checkboxes) the model reconstructed.
    if (insertTranscription && recognition?.markdown) {
      editor.commands.insertContent(smartConvertToHtml(recognition.markdown));
    }
  }, [editor]);

  if (!isMounted || !editor) {
    return (
      <div className={cn("border rounded-lg bg-background", className)}>
        <div className="h-12 border-b bg-muted/50" />
        <div className="min-h-[300px] p-4 animate-pulse">
          <div className="h-4 bg-muted rounded w-3/4 mb-2" />
          <div className="h-4 bg-muted rounded w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={cn("lg:border lg:rounded-lg bg-background bp-notebook", className)}>
        {/* Toolbar — hidden for read-only (viewer) mode */}
        {editable && <div className="bp-notebook-toolbar sticky top-0 z-30 flex items-center gap-1 p-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 overflow-x-auto md:flex-wrap md:overflow-visible scrollbar-hide lg:bg-muted/30 lg:backdrop-blur-none">
        <ToolbarButton
          onClick={() => {
            editor.chain().focus().toggleHeading({ level: 1 }).run();
          }}
          isActive={editor.isActive("heading", { level: 1 })}
          title="Heading 1"
          shortcut="Markdown: #"
        >
          <Heading1 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => {
            editor.chain().focus().toggleHeading({ level: 2 }).run();
          }}
          isActive={editor.isActive("heading", { level: 2 })}
          title="Heading 2"
          shortcut="Markdown: ##"
        >
          <Heading2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => {
            editor.chain().focus().toggleHeading({ level: 3 }).run();
          }}
          isActive={editor.isActive("heading", { level: 3 })}
          title="Heading 3"
          shortcut="Markdown: ###"
        >
          <Heading3 className="h-4 w-4" />
        </ToolbarButton>

        {/* MOBILE: Hide separators on mobile to save space */}
        <Separator orientation="vertical" className="h-6 mx-1 hidden md:block" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive("bold")}
          title="Bold"
          shortcut="⌘B"
        >
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive("italic")}
          title="Italic"
          shortcut="⌘I"
        >
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive("strike")}
          title="Strikethrough"
          shortcut="⌘⇧X"
        >
          <Strikethrough className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          isActive={editor.isActive("code")}
          title="Inline Code"
          shortcut="⌘E"
        >
          <Code className="h-4 w-4" />
        </ToolbarButton>
        <AnnotationToolbarButton editor={editor} />

        <Separator orientation="vertical" className="h-6 mx-1 hidden md:block" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive("bulletList")}
          title="Bullet List"
          shortcut="⌘⇧8"
        >
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive("orderedList")}
          title="Numbered List"
          shortcut="⌘⇧7"
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          isActive={editor.isActive("taskList")}
          title="Checklist"
        >
          <CheckSquare className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="h-6 mx-1 hidden md:block" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive("blockquote")}
          title="Blockquote"
          shortcut="⌘⇧B"
        >
          <Quote className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Horizontal Divider"
          shortcut="Markdown: ---"
        >
          <Minus className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={setLink}
          isActive={editor.isActive("link")}
          title="Insert Link"
        >
          <LinkIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
          isActive={editor.isActive("table")}
          title="Insert Table"
        >
          <TableIcon className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="h-6 mx-1 hidden md:block" />

        <EditorVoiceButton editor={editor} />

        <ToolbarButton
          onClick={() => setShowSketch(true)}
          title="Draw / handwrite"
        >
          <PenTool className="h-4 w-4" />
        </ToolbarButton>

        {noteId && (
          <>
            <Separator orientation="vertical" className="h-6 mx-1 hidden md:block" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAttachmentPicker(true)}
                  className="h-10 w-10 p-0 md:h-8 md:w-8 shrink-0"
                >
                  <Paperclip className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Attach files or images</TooltipContent>
            </Tooltip>
          </>
        )}

        <div className="flex-1 min-w-4" />

        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo"
          shortcut="⌘Z"
        >
          <Undo className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo"
          shortcut="⌘⇧Z"
        >
          <Redo className="h-4 w-4" />
        </ToolbarButton>
      </div>}

        {/* Editor */}
        <EditorContent editor={editor} />
      </div>

      {editor && <ImageFloatingMenu editor={editor} />}
      {editor && editable && <AnnotationBubbleMenu editor={editor} />}

      {noteId && (
        <AttachmentPicker
          open={showAttachmentPicker}
          onClose={() => setShowAttachmentPicker(false)}
          onSelect={handleInsertAttachments}
          projectId={projectId}
          noteId={noteId}
        />
      )}

      <SketchDialog
        open={showSketch}
        onOpenChange={setShowSketch}
        noteId={noteId}
        projectId={projectId}
        onComplete={handleSketchComplete}
      />
    </>
  );
}

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title: string;
  shortcut?: string;
  children: React.ReactNode;
}

/**
 * ToolbarButton - Editor toolbar button with mobile-optimized touch targets
 *
 * TOUCH: 40px on mobile (h-10 w-10), 32px on desktop (md:h-8 md:w-8)
 */
function ToolbarButton({
  onClick,
  isActive,
  disabled,
  title,
  shortcut,
  children,
}: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onMouseDown={(e) => {
            e.preventDefault();
            onClick();
          }}
          disabled={disabled}
          className={cn(
            // TOUCH: Larger on mobile for easier tapping
            "h-10 w-10 p-0 md:h-8 md:w-8 shrink-0",
            isActive && "bg-muted text-foreground"
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <span>{title}</span>
        {shortcut && <kbd className="ml-1.5 text-[10px] opacity-60">{shortcut}</kbd>}
      </TooltipContent>
    </Tooltip>
  );
}
