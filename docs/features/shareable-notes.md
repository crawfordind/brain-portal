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
