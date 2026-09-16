# Task Recommendations Badge - Design Document

**Date:** 2026-02-02
**Status:** Approved
**Owner:** Brain Portal Team

## Overview

Add a status indicator badge to the "Tasks" navigation item showing the count of pending task recommendations (AI-generated suggestions waiting for user review). The badge will appear similar to the existing Inbox badge, on both desktop sidebar and mobile bottom navigation.

## Requirements

### Core Features
1. **Badge on Tasks Nav Item** - Show count of pending task recommendations
2. **Reuse Existing Data** - Use data already fetched by `useInboxCount` hook
3. **Consistent Design** - Match the visual style of the Inbox badge
4. **Cross-Platform** - Display on both desktop (Sidebar) and mobile (BottomNav)
5. **Real-time Updates** - Badge count updates every 60 seconds (existing polling)

### User Experience
- Desktop: Badge appears on the right side of "Tasks" text with number
- Mobile: Small badge in top-right corner of Tasks icon with number
- Badge only shows when count > 0
- No performance impact (reuses existing API calls)

## Architecture

### Data Flow

```
useInboxCount hook (existing)
  ├─ Fetches /api/tasks/recommendations?status=pending
  ├─ Returns counts.recommendations
  └─ Polls every 60 seconds

Sidebar & BottomNav components
  ├─ Already use useInboxCount for Inbox badge
  ├─ Now also check counts.recommendations for Tasks badge
  └─ Display badge conditionally
```

### No New Infrastructure Needed

**Reused components:**
- `useInboxCount` hook - Already fetches task recommendations count
- `Badge` UI component - Same visual style as Inbox
- Navigation components - Just add conditional logic

**No new API calls:**
- Task recommendations count already fetched for Inbox total
- Same 60-second refresh interval
- No additional database queries

## Implementation

### Component Changes

**1. Sidebar.tsx (Desktop Navigation)**

Current code (line 60):
```typescript
const showBadge = item.name === "Inbox" && counts.total > 0;
```

Updated code:
```typescript
const showBadge =
  (item.name === "Inbox" && counts.total > 0) ||
  (item.name === "Tasks" && counts.recommendations > 0);

const badgeCount = item.name === "Inbox"
  ? counts.total
  : counts.recommendations;
```

Then update Badge component (line 76-79):
```typescript
{showBadge && (
  <Badge variant="default" className="ml-auto">
    {badgeCount}
  </Badge>
)}
```

**2. BottomNav.tsx (Mobile Navigation)**

Current code (line 61):
```typescript
const showBadge = item.name === "Inbox" && counts.total > 0;
```

Updated code:
```typescript
const showBadge =
  (item.name === "Inbox" && counts.total > 0) ||
  (item.name === "Tasks" && counts.recommendations > 0);

const badgeCount = item.name === "Inbox"
  ? counts.total
  : counts.recommendations;
```

Then update Badge component (line 79-86):
```typescript
{showBadge && (
  <Badge
    variant="default"
    className="absolute top-1 right-1 h-4 min-w-4 px-1 text-[10px] flex items-center justify-center"
  >
    {badgeCount > 9 ? "9+" : badgeCount}
  </Badge>
)}
```

### Files Modified

- `src/components/layout/sidebar.tsx` - Add Tasks badge logic
- `src/components/layout/bottom-nav.tsx` - Add Tasks badge logic

### Files Unchanged

- `src/hooks/use-inbox-count.ts` - No changes needed
- `src/lib/navigation.ts` - No changes needed
- `src/app/api/tasks/recommendations/route.ts` - No changes needed

## Testing Strategy

### Manual Testing

1. **Create task recommendations** - Use note cleanup feature to generate recommendations
2. **Verify badge appears** - Check both desktop sidebar and mobile bottom nav
3. **Verify count accuracy** - Badge count should match pending recommendations
4. **Test badge hiding** - Accept/dismiss all recommendations, badge should disappear
5. **Test mobile layout** - Badge should not overlap with icon or text
6. **Test number formatting** - Mobile should show "9+" for counts > 9

### Edge Cases

1. **Zero recommendations** - Badge should not appear
2. **Large numbers** - Desktop shows full number, mobile shows "9+" cap
3. **Multiple users** - Each user sees only their own recommendations count
4. **Rapid updates** - Count updates smoothly without flickering

## Success Metrics

- Badge accurately reflects pending task recommendations count
- No additional API calls or performance impact
- Consistent visual design with Inbox badge
- Works on both desktop and mobile layouts

## Future Enhancements

1. **Breakdown badge** - Show count of different recommendation types (on hover/tap)
2. **Priority indicator** - Color-code badge by highest priority recommendation
3. **Direct navigation** - Click badge to jump to recommendations view
4. **Notification system** - Push notifications for high-priority recommendations
