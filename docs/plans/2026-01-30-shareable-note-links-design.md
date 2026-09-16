# Shareable Note Links - Design Document

**Date:** 2026-01-30
**Status:** Approved for Implementation

## Overview

Allow users to generate public read-only links for any note with simple on/off sharing control.

## Database Schema

### Changes to `notes` Table

Add two new columns:
- `share_token TEXT UNIQUE` - UUID v4 token for public access (null when not shared)
- `shared_at TEXT` - Timestamp when sharing was enabled (null when not shared)

Add index:
```sql
CREATE INDEX idx_notes_share_token ON notes(share_token)
  WHERE share_token IS NOT NULL;
```

**Rationale:**
- No new table needed - sharing is a simple property of notes
- `share_token` being null vs non-null serves as the on/off toggle
- UNIQUE constraint ensures no token collisions
- Indexed for fast public route lookups without exposing user_id

## API Endpoints

Following existing patterns from `/api/notes/[id]/route.ts`:

1. **`POST /api/notes/[id]/share`** - Enable sharing
   - Generates UUID v4 token
   - Sets `share_token` and `shared_at`
   - Returns: `{ shareUrl: string, token: string }`

2. **`DELETE /api/notes/[id]/share`** - Revoke sharing
   - Sets `share_token` to null
   - Sets `shared_at` to null
   - Returns: `{ success: true }`

3. **`PUT /api/notes/[id]/share`** - Regenerate token
   - Generates new UUID v4
   - Updates `share_token` and `shared_at`
   - Old token immediately invalidated
   - Returns: `{ shareUrl: string, token: string }`

4. **`GET /shared/[token]`** - Public route (no auth)
   - Looks up note by share_token
   - Only returns if `share_token IS NOT NULL`
   - Returns minimal note data: title, content only

## UI/UX Implementation

### Share Dialog Component

Create `src/components/notes/share-dialog.tsx`:

**Three States:**
1. **Not Shared**: "Share this note" button → generates token, shows URL
2. **Currently Shared**: Shows share URL with copy button, "Stop Sharing" button, "Regenerate Link" button
3. **Loading**: While generating/revoking

**Copy Flow:**
- Use `navigator.clipboard.writeText(shareUrl)`
- Show toast: "Link copied to clipboard"
- Auto-select URL text for visual feedback

### Integration into Note Detail Page

Modify `src/app/(dashboard)/notes/[slug]/page.tsx`:
- Add "Share" menu item to existing DropdownMenu (after Archive, before Delete separator)
- Icon: `Share2` from lucide-react
- Opens ShareDialog component

### Share URL Format

```
${process.env.NEXT_PUBLIC_APP_URL}/shared/${token}
```

Example: `https://brainportal.app/shared/a1b2c3d4-e5f6-7890-abcd-ef1234567890`

## Public Route Implementation

Create `src/app/shared/[token]/page.tsx`:

**Characteristics:**
- No authentication required (outside dashboard group)
- Clean, minimal layout with no app chrome
- Only shows: title and rendered markdown content
- Uses read-only markdown renderer

**SQL Query:**
```sql
SELECT id, title, content, word_count
FROM notes
WHERE share_token = ? AND share_token IS NOT NULL
```

**Layout:**
- Centered content container (max-width: 65ch for readability)
- Clean typography
- Responsive design for mobile

## Security Measures

### 1. Rate Limiting

Apply to `/shared/[token]` route:
- Limit: 100 requests per IP per hour
- Prevents scraping and enumeration attacks
- Return 429 Too Many Requests when exceeded
- Use existing rate limiting patterns if available

### 2. Token Unguessability

- UUID v4: 122 bits of entropy (5.3×10³⁶ possibilities)
- Collision-resistant and brute-force resistant
- Generated using `crypto.randomUUID()` (built into Node)

### 3. No Enumeration

- Don't reveal whether token exists or is revoked
- Always return 404 "Note not found" for invalid/revoked tokens
- No timing attacks (constant-time lookup)

### 4. Content Sanitization

- Markdown renderer must not execute scripts
- Already handled by existing markdown editor/renderer

## Edge Cases

### Archived/Deleted Notes

- **Archived**: Shared link still works (user chose to share it)
- **Deleted**: `share_token` cascade deleted → 404 on public route

### Content Updates

- Shared link always shows latest content (no versioning)
- User can edit note, changes immediately visible on shared link

### Mobile Responsiveness

- Share dialog must work on mobile (consider bottom sheet for small screens)
- Public shared page must be mobile-friendly

### SEO

- Add basic meta tags to shared page (title, description)
- Set `noindex, nofollow` (personal notes, not for search engines)

## Migration

Create `scripts/migrations/add-note-sharing.ts`:

```sql
ALTER TABLE notes ADD COLUMN share_token TEXT UNIQUE;
ALTER TABLE notes ADD COLUMN shared_at TEXT;
CREATE INDEX idx_notes_share_token ON notes(share_token)
  WHERE share_token IS NOT NULL;
```

Run via: `npm run db:migrate`

## Testing Checklist

- [ ] Generate share token, verify unique URL created
- [ ] Copy link, open in incognito → see note content
- [ ] Revoke sharing → link returns 404
- [ ] Regenerate token → old link 404, new link works
- [ ] Rate limit enforcement (101st request blocked)
- [ ] Mobile: share dialog UX, public page rendering
- [ ] Archive note → shared link still works
- [ ] Delete note → shared link returns 404

## Implementation Order

1. Database migration (add columns + index)
2. API routes (share/revoke/regenerate endpoints)
3. Share dialog component
4. Integrate dialog into note detail page
5. Public route `/shared/[token]`
6. Rate limiting middleware
7. Testing & polish
