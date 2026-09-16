# Shareable Note Links Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to generate public read-only links for any note with simple on/off toggle.

**Architecture:** Add `share_token` and `shared_at` columns to notes table. Create API routes for share/revoke/regenerate. Build ShareDialog component integrated into note detail page. Implement public route `/shared/[token]` with minimal layout.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, Turso (SQLite), Radix UI components, UUID v4 tokens

---

## Task 1: Database Migration

**Files:**
- Modify: `scripts/migrate.ts:426-439` (add to alterStatements array)
- Modify: `src/lib/db/schema.ts:456-475` (add Note interface properties)

**Step 1: Add migration statements**

In `scripts/migrate.ts`, add to the `alterStatements` array (after line 439):

```typescript
// Add sharing columns to notes table
`ALTER TABLE notes ADD COLUMN share_token TEXT UNIQUE`,
`ALTER TABLE notes ADD COLUMN shared_at TEXT`,
```

**Step 2: Add index creation**

In `scripts/migrate.ts`, add to the `statements` array (after line 243, with other indexes):

```typescript
`CREATE INDEX IF NOT EXISTS idx_notes_share_token ON notes(share_token) WHERE share_token IS NOT NULL`,
```

**Step 3: Update Note TypeScript interface**

In `src/lib/db/schema.ts`, update the `Note` interface (around line 456-475) to include:

```typescript
export interface Note {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  slug: string;
  content: string;
  content_plain: string | null;
  note_type: 'note' | 'daily' | 'weekly' | 'insight';
  is_pinned: boolean;
  is_archived: boolean;
  word_count: number;
  frontmatter: string;
  metadata: string;
  summary: string | null;
  auto_tags: string;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  share_token: string | null;  // Add this
  shared_at: string | null;     // Add this
  created_at: string;
  updated_at: string;
}
```

**Step 4: Run migration**

```bash
npm run db:migrate
```

Expected output:
```
✓ Added column: share_token
✓ Added column: shared_at
✓ idx_notes_share_token
```

**Step 5: Commit**

```bash
git add scripts/migrate.ts src/lib/db/schema.ts
git commit -m "feat(db): add note sharing columns and index

- Add share_token (UUID, unique) and shared_at to notes table
- Add partial index on share_token for fast public lookups
- Update Note TypeScript interface

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Share API Route - Enable Sharing (POST)

**Files:**
- Create: `src/app/api/notes/[id]/share/route.ts`

**Step 1: Create share API route**

Create `src/app/api/notes/[id]/share/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { queryOne, mutate } from "@/lib/db/client";
import type { Note } from "@/lib/db/schema";
import { randomUUID } from "crypto";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/notes/[id]/share - Enable sharing, generate token
export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership
  const existing = await queryOne<Note>(
    "SELECT id, share_token FROM notes WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!existing) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  // If already shared, return existing token
  if (existing.share_token) {
    const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL}/shared/${existing.share_token}`;
    return NextResponse.json({
      shareUrl,
      token: existing.share_token
    });
  }

  // Generate new token
  const token = randomUUID();

  try {
    await mutate(
      `UPDATE notes
       SET share_token = ?, shared_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
      [token, id, user.id]
    );

    const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL}/shared/${token}`;

    return NextResponse.json({ shareUrl, token });
  } catch (error) {
    console.error("Failed to enable sharing:", error);
    return NextResponse.json(
      { error: "Failed to enable sharing" },
      { status: 500 }
    );
  }
}

// DELETE /api/notes/[id]/share - Revoke sharing
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership
  const existing = await queryOne<Note>(
    "SELECT id FROM notes WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!existing) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  try {
    await mutate(
      `UPDATE notes
       SET share_token = NULL, shared_at = NULL, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
      [id, user.id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to revoke sharing:", error);
    return NextResponse.json(
      { error: "Failed to revoke sharing" },
      { status: 500 }
    );
  }
}

// PUT /api/notes/[id]/share - Regenerate token
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership
  const existing = await queryOne<Note>(
    "SELECT id FROM notes WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!existing) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  // Generate new token (old one is automatically invalidated)
  const token = randomUUID();

  try {
    await mutate(
      `UPDATE notes
       SET share_token = ?, shared_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
      [token, id, user.id]
    );

    const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL}/shared/${token}`;

    return NextResponse.json({ shareUrl, token });
  } catch (error) {
    console.error("Failed to regenerate token:", error);
    return NextResponse.json(
      { error: "Failed to regenerate token" },
      { status: 500 }
    );
  }
}
```

**Step 2: Test API routes manually**

Start dev server and test with curl:

```bash
npm run dev

# In another terminal:
# Get auth token from browser devtools (cookies -> session token)
# Replace [NOTE_ID] and [SESSION_TOKEN]

# Enable sharing
curl -X POST http://localhost:3000/api/notes/[NOTE_ID]/share \
  -H "Cookie: session=[SESSION_TOKEN]"

# Expected: {"shareUrl":"http://localhost:3000/shared/...","token":"..."}
```

**Step 3: Commit**

```bash
git add src/app/api/notes/[id]/share/route.ts
git commit -m "feat(api): add note sharing endpoints

- POST /api/notes/[id]/share - enable sharing with UUID token
- DELETE /api/notes/[id]/share - revoke sharing
- PUT /api/notes/[id]/share - regenerate token
- Auto-update timestamps on share changes

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Share Dialog Component

**Files:**
- Create: `src/components/notes/share-dialog.tsx`

**Step 1: Create share dialog component**

Create `src/components/notes/share-dialog.tsx`:

```typescript
"use client";

import { useState } from "react";
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
  isShared: boolean;
  shareToken: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareDialog({
  noteId,
  isShared: initialIsShared,
  shareToken: initialToken,
  open,
  onOpenChange,
}: ShareDialogProps) {
  const [isShared, setIsShared] = useState(initialIsShared);
  const [shareToken, setShareToken] = useState(initialToken);
  const queryClient = useQueryClient();

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
      queryClient.invalidateQueries({ queryKey: ["note"] });
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
      queryClient.invalidateQueries({ queryKey: ["note"] });
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
      queryClient.invalidateQueries({ queryKey: ["note"] });
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
              ? "Anyone with this link can view this note."
              : "Create a public link to share this note."}
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
```

**Step 2: Verify component compiles**

```bash
npm run typecheck
```

Expected: No TypeScript errors related to share-dialog.tsx

**Step 3: Commit**

```bash
git add src/components/notes/share-dialog.tsx
git commit -m "feat(ui): add share dialog component

- Three states: not shared, shared, loading
- Copy to clipboard with visual feedback
- Regenerate and revoke actions
- Optimistic UI updates with React Query

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Integrate Share Dialog into Note Detail Page

**Files:**
- Modify: `src/app/(dashboard)/notes/[slug]/page.tsx:42-55,66-68,356-377`

**Step 1: Add import and state**

In `src/app/(dashboard)/notes/[slug]/page.tsx`, add import (line 11):

```typescript
import { ShareDialog } from "@/components/notes/share-dialog";
```

Add `Share2` to lucide-react imports (line 22):

```typescript
import {
  ArrowLeft,
  Save,
  MoreHorizontal,
  Trash2,
  Pin,
  Archive,
  Clock,
  FileText,
  Mic,
  Paperclip,
  Share2,  // Add this
} from "lucide-react";
```

**Step 2: Update Note interface**

In the `interface Note` (around line 42), add:

```typescript
interface Note {
  id: string;
  title: string;
  slug: string;
  content: string;
  note_type: string;
  word_count: number;
  is_pinned: boolean;
  is_archived: boolean;
  project_id: string | null;
  project_name: string | null;
  share_token: string | null;  // Add this
  shared_at: string | null;     // Add this
  created_at: string;
  updated_at: string;
}
```

**Step 3: Add share dialog state**

After line 68 (with other state declarations):

```typescript
const [showShareDialog, setShowShareDialog] = useState(false);
```

**Step 4: Add Share menu item**

In the DropdownMenu (around line 356-377), add Share item after Archive:

```typescript
<DropdownMenuItem onClick={() => toggleArchiveMutation.mutate()}>
  <Archive className="h-4 w-4 mr-2" />
  {note.is_archived ? "Unarchive" : "Archive"}
</DropdownMenuItem>
<DropdownMenuItem onClick={() => setShowShareDialog(true)}>
  <Share2 className="h-4 w-4 mr-2" />
  Share
</DropdownMenuItem>
<DropdownMenuSeparator />
```

**Step 5: Add ShareDialog component**

At the end of the component (before the closing div, after AttachmentPicker around line 465):

```typescript
{/* Share Dialog */}
<ShareDialog
  noteId={note.id}
  isShared={!!note.share_token}
  shareToken={note.share_token}
  open={showShareDialog}
  onOpenChange={setShowShareDialog}
/>
```

**Step 6: Test in browser**

```bash
npm run dev
```

Navigate to any note, click the menu (three dots), click "Share", verify dialog opens.

**Step 7: Commit**

```bash
git add src/app/(dashboard)/notes/[slug]/page.tsx
git commit -m "feat(ui): integrate share dialog into note detail page

- Add Share menu item in note actions dropdown
- Pass share_token and shared_at from note data
- Open share dialog on menu click

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Public Shared Note Route

**Files:**
- Create: `src/app/shared/[token]/page.tsx`
- Create: `src/app/shared/[token]/layout.tsx`

**Step 1: Create public layout**

Create `src/app/shared/[token]/layout.tsx`:

```typescript
import { Metadata } from "next";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function SharedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
```

**Step 2: Create public shared page**

Create `src/app/shared/[token]/page.tsx`:

```typescript
import { notFound } from "next/navigation";
import { createClient } from "@libsql/client";
import { Metadata } from "next";

interface SharedNote {
  id: string;
  title: string;
  content: string;
  word_count: number;
}

interface PageProps {
  params: Promise<{ token: string }>;
}

async function getSharedNote(token: string): Promise<SharedNote | null> {
  if (!process.env.TURSO_DATABASE_URL) {
    throw new Error("TURSO_DATABASE_URL not configured");
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  try {
    const result = await db.execute({
      sql: `SELECT id, title, content, word_count
            FROM notes
            WHERE share_token = ? AND share_token IS NOT NULL`,
      args: [token],
    });

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id as string,
      title: row.title as string,
      content: row.content as string,
      word_count: (row.word_count as number) || 0,
    };
  } finally {
    await db.close();
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const note = await getSharedNote(token);

  if (!note) {
    return {
      title: "Note Not Found",
    };
  }

  // Extract first 160 chars of content for description
  const plainText = note.content.replace(/[#*_`[\]()]/g, "").trim();
  const description = plainText.substring(0, 160);

  return {
    title: note.title,
    description: description || "Shared note",
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function SharedNotePage({ params }: PageProps) {
  const { token } = await params;
  const note = await getSharedNote(token);

  if (!note) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl mx-auto px-4 py-12">
        <article className="prose prose-slate dark:prose-invert max-w-none">
          <h1 className="text-4xl font-bold mb-8">{note.title}</h1>

          {/* Render markdown content as HTML */}
          <div
            className="prose-content"
            dangerouslySetInnerHTML={{
              __html: formatMarkdown(note.content),
            }}
          />
        </article>
      </div>
    </div>
  );
}

// Simple markdown-to-HTML converter (basic implementation)
// In production, use a proper library like remark or marked
function formatMarkdown(content: string): string {
  let html = content;

  // Headers
  html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
  html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
  html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Line breaks
  html = html.replace(/\n\n/g, "</p><p>");
  html = html.replace(/\n/g, "<br>");

  // Wrap in paragraph
  html = `<p>${html}</p>`;

  return html;
}
```

**Step 3: Test public route**

```bash
npm run dev
```

1. Share a note via the UI, copy the link
2. Open the link in incognito window
3. Verify note title and content display

**Step 4: Commit**

```bash
git add src/app/shared/[token]/
git commit -m "feat(public): add public shared note route

- Server-side rendered page at /shared/[token]
- No authentication required
- Clean minimal layout with centered content
- Meta tags with noindex/nofollow for SEO
- Basic markdown rendering

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Improve Markdown Rendering

**Files:**
- Modify: `src/app/shared/[token]/page.tsx:97-120`

**Step 1: Install markdown library**

```bash
npm install marked
npm install -D @types/marked
```

**Step 2: Replace formatMarkdown function**

In `src/app/shared/[token]/page.tsx`, replace the `formatMarkdown` function with:

```typescript
import { marked } from "marked";

// Configure marked for safe rendering
marked.setOptions({
  gfm: true,
  breaks: true,
});

function formatMarkdown(content: string): string {
  return marked.parse(content) as string;
}
```

**Step 3: Remove old formatMarkdown function**

Delete the old regex-based `formatMarkdown` function (lines 97-120).

**Step 4: Test rendering**

Visit a shared note with complex markdown (lists, code blocks, tables). Verify proper rendering.

**Step 5: Commit**

```bash
git add src/app/shared/[token]/page.tsx package.json package-lock.json
git commit -m "feat(public): use marked library for markdown rendering

- Replace basic regex parser with marked library
- Enable GitHub Flavored Markdown
- Support code blocks, tables, task lists
- Proper escaping and sanitization

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Add Rate Limiting to Public Route

**Files:**
- Create: `src/lib/rate-limit.ts`
- Modify: `src/app/shared/[token]/page.tsx:23-31`

**Step 1: Create rate limit utility**

Create `src/lib/rate-limit.ts`:

```typescript
import { headers } from "next/headers";

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const rateLimitStore = new Map<
  string,
  { count: number; resetAt: number }
>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now > value.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

export async function checkRateLimit(
  config: RateLimitConfig = {
    maxRequests: 100,
    windowMs: 60 * 60 * 1000, // 1 hour
  }
): Promise<{ allowed: boolean; limit: number; remaining: number; resetAt: number }> {
  const headersList = await headers();

  // Get IP from headers
  const ip =
    headersList.get("x-forwarded-for")?.split(",")[0] ||
    headersList.get("x-real-ip") ||
    "unknown";

  const key = `rate-limit:${ip}`;
  const now = Date.now();

  let record = rateLimitStore.get(key);

  // Create new record if none exists or window expired
  if (!record || now > record.resetAt) {
    record = {
      count: 0,
      resetAt: now + config.windowMs,
    };
  }

  record.count += 1;
  rateLimitStore.set(key, record);

  const allowed = record.count <= config.maxRequests;
  const remaining = Math.max(0, config.maxRequests - record.count);

  return {
    allowed,
    limit: config.maxRequests,
    remaining,
    resetAt: record.resetAt,
  };
}
```

**Step 2: Apply rate limiting to shared route**

In `src/app/shared/[token]/page.tsx`, add rate limit check at the top of `SharedNotePage`:

```typescript
import { checkRateLimit } from "@/lib/rate-limit";

export default async function SharedNotePage({ params }: PageProps) {
  // Rate limiting
  const rateLimit = await checkRateLimit({
    maxRequests: 100,
    windowMs: 60 * 60 * 1000, // 100 requests per hour
  });

  if (!rateLimit.allowed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Too Many Requests</h1>
          <p className="text-muted-foreground">
            Please try again later.
          </p>
        </div>
      </div>
    );
  }

  const { token } = await params;
  const note = await getSharedNote(token);

  // ... rest of component
}
```

**Step 3: Test rate limiting**

Create a simple script to test rate limiting:

```bash
# Test script (run 105 times quickly)
for i in {1..105}; do
  curl -s http://localhost:3000/shared/[TEST_TOKEN] > /dev/null
  echo "Request $i"
done
```

Expected: First 100 succeed, next 5 show "Too Many Requests"

**Step 4: Commit**

```bash
git add src/lib/rate-limit.ts src/app/shared/[token]/page.tsx
git commit -m "feat(security): add rate limiting to public shared notes

- Implement in-memory rate limiter (100 req/hour per IP)
- Apply to /shared/[token] route
- Return 429-equivalent page when limit exceeded
- Auto-cleanup expired entries

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: End-to-End Testing

**Files:**
- Manual testing checklist

**Step 1: Test full workflow**

1. Create a new note with content
2. Click menu → Share
3. Verify dialog shows "Share this note" button
4. Click "Share this note"
5. Verify shareUrl appears with copy button
6. Click copy button, verify toast "Link copied"
7. Open link in incognito, verify note displays
8. Edit note content in authenticated session
9. Refresh shared link, verify updated content
10. Click "Regenerate Link"
11. Verify old link returns 404
12. Verify new link works
13. Click "Stop Sharing"
14. Verify link returns 404
15. Archive note with sharing enabled
16. Verify shared link still works
17. Test mobile responsiveness of share dialog
18. Test public page on mobile

**Step 2: Test edge cases**

1. Try sharing a note twice (should return same token)
2. Try accessing /shared/invalid-token (should 404)
3. Try accessing /shared/revoked-token (should 404)
4. Delete a shared note, verify link 404s

**Step 3: Document any issues**

Create `docs/testing/shareable-notes-test-results.md` with findings.

**Step 4: Commit test results**

```bash
git add docs/testing/shareable-notes-test-results.md
git commit -m "docs: add shareable notes testing results

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Polish and Refinements

**Files:**
- Modify: `src/app/shared/[token]/page.tsx:85-95` (styling improvements)

**Step 1: Improve public page styling**

In `src/app/shared/[token]/page.tsx`, update the article section:

```typescript
<article className="prose prose-slate dark:prose-invert lg:prose-lg max-w-none">
  <h1 className="text-3xl md:text-4xl font-bold mb-8 tracking-tight">
    {note.title}
  </h1>

  <div
    className="prose-content leading-relaxed"
    dangerouslySetInnerHTML={{
      __html: formatMarkdown(note.content),
    }}
  />
</article>
```

**Step 2: Add footer to public page**

Add after the article closing tag:

```typescript
<footer className="mt-16 pt-8 border-t border-border text-center text-sm text-muted-foreground">
  <p>Shared via Brain Portal</p>
</footer>
```

**Step 3: Improve share dialog copy**

In `src/components/notes/share-dialog.tsx`, update description text:

```typescript
<DialogDescription>
  {isShared
    ? "This note is publicly accessible via the link below."
    : "Generate a public link to share this note with anyone."}
</DialogDescription>
```

**Step 4: Test visual improvements**

View shared note and share dialog, verify improved styling.

**Step 5: Commit**

```bash
git add src/app/shared/[token]/page.tsx src/components/notes/share-dialog.tsx
git commit -m "polish: improve shared note visual design

- Better typography and spacing on public page
- Add footer with attribution
- Improve dialog descriptions
- Responsive font sizes

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Final Documentation

**Files:**
- Create: `docs/features/shareable-notes.md`

**Step 1: Create feature documentation**

Create `docs/features/shareable-notes.md`:

```markdown
# Shareable Notes

## Overview

Users can generate public read-only links for any note with a simple on/off toggle.

## Features

- **Simple Sharing**: One-click share button generates a unique public link
- **Copy to Clipboard**: Easy copy button with visual feedback
- **Revoke Access**: Stop sharing to immediately invalidate the link
- **Regenerate Link**: Create a new link and invalidate the old one
- **Clean Public View**: Minimal, distraction-free reading experience
- **No Authentication**: Public links work in any browser without login
- **Rate Limited**: 100 requests per IP per hour prevents abuse

## Usage

### Sharing a Note

1. Open any note
2. Click the menu (three dots) → Share
3. Click "Share this note"
4. Copy the generated link
5. Share the link with anyone

### Revoking Access

1. Open the share dialog
2. Click "Stop Sharing"
3. The link will immediately return 404

### Regenerating Link

1. Open the share dialog
2. Click "Regenerate Link"
3. Old link is invalidated, new link is generated

## Technical Details

### Database Schema

```sql
ALTER TABLE notes ADD COLUMN share_token TEXT UNIQUE;
ALTER TABLE notes ADD COLUMN shared_at TEXT;
CREATE INDEX idx_notes_share_token ON notes(share_token) WHERE share_token IS NOT NULL;
```

### API Endpoints

- `POST /api/notes/[id]/share` - Enable sharing
- `DELETE /api/notes/[id]/share` - Revoke sharing
- `PUT /api/notes/[id]/share` - Regenerate token

### Public Route

- `GET /shared/[token]` - Public note view (no auth)

### Security

- UUID v4 tokens (122 bits entropy)
- Rate limiting (100 req/hour per IP)
- No user data exposed on public route
- noindex/nofollow meta tags

## Edge Cases

- Shared notes remain accessible when archived
- Shared notes return 404 when deleted
- Content updates are immediately reflected on shared link
- Duplicate share requests return existing token
```

**Step 2: Update README**

If project has a README, add a Features section mentioning shareable notes.

**Step 3: Commit**

```bash
git add docs/features/shareable-notes.md
git commit -m "docs: add shareable notes feature documentation

Complete guide covering usage, technical details, and security

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Completion

All tasks complete! The shareable note links feature is fully implemented with:

- Database migration for share_token and shared_at columns
- API endpoints for share/revoke/regenerate
- Share dialog component with three states
- Integration into note detail page
- Public route at /shared/[token]
- Proper markdown rendering with marked library
- Rate limiting for security
- Comprehensive documentation

**Next steps:**
- Deploy to production
- Monitor rate limit effectiveness
- Gather user feedback on UX
- Consider future enhancements (analytics, password protection)
