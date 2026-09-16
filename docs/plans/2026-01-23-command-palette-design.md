# Command Palette Design Specification

**Date:** January 23, 2026
**Feature:** Unified Command Palette (Mobile-First)
**Estimated Effort:** 4-6 hours
**Status:** Approved for Implementation

---

## Executive Summary

Brain Portal currently has a robust voice command system but lacks a keyboard-driven command interface. This creates a competitive gap against Notion (Cmd+K) and Obsidian (Cmd+P). This design introduces a **unified command palette** that works seamlessly across both mobile and desktop, triggered by:

- **Desktop:** `Cmd+K` / `Ctrl+K` keyboard shortcut
- **Mobile:** Long-press (500ms) on existing Voice FAB
- **Both:** Supports typed search AND reuses existing voice command infrastructure

---

## Design Principles

1. **Mobile-First:** Touch-optimized UI, gesture support, thumb-friendly interactions
2. **Unified Command System:** Voice and typed commands share the same registry
3. **Progressive Disclosure:** Show quick actions first, full search as user types
4. **Zero Breaking Changes:** Extends existing voice system without disruption
5. **Keyboard Power User:** Full keyboard navigation for desktop efficiency

---

## User Experience

### Trigger Mechanisms

#### Mobile (< 768px)
```
Voice FAB Interaction:
- TAP (< 500ms)        → Start voice recording (existing behavior)
- LONG-PRESS (≥ 500ms) → Open command palette + haptic feedback
- While recording      → Long-press disabled (prevent accidents)
```

#### Desktop (≥ 768px)
```
Keyboard Shortcuts:
- Cmd+K / Ctrl+K  → Open command palette
- Esc             → Close palette
- ↓ / ↑           → Navigate results
- Enter           → Execute selected command
- Tab             → Cycle through result sections
```

### Command Palette UI

**Empty State (No Query):**
```
┌─────────────────────────────┐
│ 🔍 Search or type command   │ ← Auto-focused input
├─────────────────────────────┤
│                             │
│ Quick Actions               │
│ ┌──────┐  ┌──────┐         │
│ │ 📝   │  │ ✓    │         │
│ │ Note │  │ Task │         │
│ └──────┘  └──────┘         │
│ ┌──────┐  ┌──────┐         │
│ │ 📸   │  │ 📅   │         │
│ │Capture  │ Today│         │
│ └──────┘  └──────┘         │
│                             │
│ Recent                      │
│ 📄 Meeting notes with team  │
│ ✓ Review pull request       │
│ 📝 Project ideas brainstorm │
│                             │
└─────────────────────────────┘
```

**With Query ("tas"):**
```
┌─────────────────────────────┐
│ 🔍 tas█                      │
├─────────────────────────────┤
│                             │
│ Commands                    │
│ ▶ ✓ New Task               │ ← Selected (highlighted)
│   📋 Go to Tasks            │
│                             │
│ Tasks (3)                   │
│   ✓ Review code changes     │
│   ✓ Call client about...   │
│   ✓ Update task manager     │
│                             │
│ Notes (1)                   │
│   📄 Task management sys... │
│                             │
└─────────────────────────────┘
```

### Search Result Ranking

Results are ranked in this order:

1. **Exact Command Match** - Commands with keyword match (instant)
2. **Recent Items** - Recently accessed notes/tasks/captures (instant)
3. **Semantic Search** - Vector similarity search (debounced 300ms)

Each section shows max 5 results. Total max: 15 visible items.

### Mobile Optimizations

- **Full-screen modal** on mobile (< 768px)
- **48px minimum touch targets** (Apple/Google accessibility guidelines)
- **Swipe-down gesture to close** (intuitive, matches iOS patterns)
- **Haptic feedback** on long-press and selection (when available)
- **Safe area handling** for iOS notch/island
- **Prevent body scroll** when palette open

### Desktop Optimizations

- **Centered modal** (max-width: 600px)
- **Keyboard navigation** with visible focus states
- **Arrow keys** for navigation
- **Tab** to cycle sections
- **Enter** to execute
- **Esc** to close

---

## Technical Architecture

### Command Registry Extension

Extend existing `VoiceCommand` interface to support typed search:

```typescript
interface UnifiedCommand extends VoiceCommand {
  // Existing voice fields
  trigger: string[];           // ["new note", "create note"]
  pattern: RegExp;

  // NEW: Keyboard search fields
  id: string;                  // "create-note"
  keywords: string[];          // ["note", "new", "create", "document"]
  label: string;               // "New Note"
  icon: LucideIcon;           // FileText
  shortcut?: string;          // "Ctrl+N" (optional, display-only)

  // Unified
  category: 'creation' | 'navigation' | 'action' | 'search';
  handler: (params) => Promise<void>;
}
```

**Key Design Decision:** We ADD fields to existing commands rather than creating a separate system. This ensures:
- Voice and keyboard share the same handlers
- No duplication of navigation/creation logic
- Single source of truth for available actions

### Data Sources

The command palette aggregates 3 data sources:

1. **Command Registry**
   - Source: Extended `use-voice-commands` hook
   - Latency: Instant (in-memory)
   - Use case: Actions ("New Note", "Go to Tasks")

2. **Recent Items**
   - Source: `activity_log` table (already exists!)
   - Query: Last 10 items, grouped by entity_type
   - Latency: Instant (React Query cached)
   - Use case: Quick navigation to recent work

3. **Semantic Search**
   - Source: Existing `/api/search` endpoint
   - Query: Vector similarity + FTS5
   - Latency: 100-300ms (debounced)
   - Use case: Finding specific notes/tasks by content

### State Management

**Zustand Store** (`command-store.ts`):

```typescript
interface CommandStore {
  // UI State
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  selectedSection: 'commands' | 'recent' | 'search';

  // Actions
  openPalette: () => void;
  closePalette: () => void;
  setQuery: (query: string) => void;
  moveSelection: (direction: 'up' | 'down') => void;
  moveToSection: (section: string) => void;
  executeSelected: () => Promise<void>;
  reset: () => void;
}
```

**Why Zustand?**
- Already used for voice store (consistency)
- Lightweight, no provider boilerplate
- Persist support for recently used commands (future)

### Component Architecture

```
<CommandPaletteProvider>           # Global provider in layout
  └─ <CommandPalette>              # Modal shell (cmdk)
      ├─ <CommandInput />          # Search input + keyboard handling
      ├─ <QuickActions />          # 2x2 grid (empty state only)
      ├─ <CommandResults>          # Results renderer
      │   ├─ <CommandSection>      # "Commands", "Recent", "Search"
      │   │   └─ <CommandItem />   # Individual result
      │   └─ ...
      └─ <CommandFooter />         # Contextual tips
```

**Key Library:** `cmdk` (already installed!)
- Built by Vercel, powers their dashboard
- Handles keyboard navigation, filtering, ranking
- Accessible by default (ARIA labels)
- Virtualized for performance

### Integration Points

**1. Voice FAB (`voice-fab.tsx`)**

Add long-press detection:

```typescript
const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);

const handleTouchStart = () => {
  if (isRecording) return; // Disable during recording

  const timer = setTimeout(() => {
    navigator.vibrate?.(50); // Haptic feedback
    openCommandPalette();
  }, 500);

  setLongPressTimer(timer);
};

const handleTouchEnd = () => {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    setLongPressTimer(null);
  }
  // If timer didn't fire, proceed with voice recording
};
```

**2. Dashboard Layout (`app/(dashboard)/layout.tsx`)**

Add global keyboard listener:

```typescript
<VoiceProvider>
  <CommandPaletteProvider>
    <ResponsiveLayout>
      {children}
    </ResponsiveLayout>
  </CommandPaletteProvider>
</VoiceProvider>
```

**3. Activity Tracking**

Leverage existing `activity_log` table:

```sql
SELECT entity_type, entity_id, MAX(created_at) as last_accessed
FROM activity_log
WHERE user_id = ?
  AND action IN ('view', 'edit', 'create')
GROUP BY entity_type, entity_id
ORDER BY last_accessed DESC
LIMIT 10
```

---

## Implementation Plan

### Phase 1: Foundation (1.5 hours)

**Step 1.1: Extend Command Registry**
- File: `src/lib/hooks/use-command-palette.ts` (new)
- Add `id`, `keywords`, `label`, `icon` to existing commands
- Create `getCommandByKeyword()` function
- No breaking changes to voice system

**Step 1.2: Create Command Store**
- File: `src/lib/stores/command-store.ts` (new)
- Zustand store for palette state
- Actions: open, close, setQuery, navigate, execute

**Step 1.3: Recent Items Hook**
- File: `src/lib/hooks/use-recent-items.ts` (new)
- Query `activity_log` for recent items
- React Query for caching
- Return typed: `{ notes: [], tasks: [], captures: [] }`

### Phase 2: Core UI (2 hours)

**Step 2.1: Command Palette Shell**
- File: `src/components/command-palette/command-palette.tsx` (new)
- Use `cmdk` library for base
- Responsive: full-screen mobile, centered desktop
- Handle keyboard shortcuts (Cmd+K, Esc)

**Step 2.2: Command Input**
- File: `src/components/command-palette/command-input.tsx` (new)
- Auto-focus on open
- Debounced search (300ms)
- Clear button

**Step 2.3: Results Rendering**
- File: `src/components/command-palette/command-results.tsx` (new)
- Section headers ("Commands", "Recent", "Search")
- Command items with icons
- Keyboard navigation
- Loading states for async search

**Step 2.4: Quick Actions**
- File: `src/components/command-palette/quick-actions.tsx` (new)
- 2x2 grid of most common actions
- Only shown when query is empty
- Touch-optimized (large tap targets)

### Phase 3: Integration (1.5 hours)

**Step 3.1: FAB Long-Press**
- Modify: `src/components/voice/voice-fab.tsx`
- Add touch event handlers
- Long-press detection (500ms)
- Haptic feedback integration

**Step 3.2: Global Provider**
- Modify: `src/app/(dashboard)/layout.tsx`
- Wrap with `<CommandPaletteProvider>`
- Global keyboard listener (Cmd+K)

**Step 3.3: Search Integration**
- File: `src/lib/hooks/use-command-search.ts` (new)
- Combine commands + recent + semantic search
- Debouncing and deduplication
- Ranking algorithm

### Phase 4: Polish (1 hour)

**Step 4.1: Mobile Gestures**
- Swipe-down to close
- Safe area handling (iOS)
- Prevent body scroll

**Step 4.2: Animations**
- Fade-in modal (150ms)
- Slide-up on mobile
- Smooth keyboard navigation

**Step 4.3: Empty States**
- "No results found" message
- "Start typing to search"
- Helpful tips in footer

**Step 4.4: Accessibility**
- ARIA labels for screen readers
- Focus management
- Keyboard trap (Tab stays in modal)
- Announce result count

---

## Dependencies

### Already Installed ✅
```json
{
  "cmdk": "^1.1.1",                    // Command palette library
  "react-hotkeys-hook": "^5.2.3",      // Keyboard shortcuts
  "zustand": "^5.0.10",                // State management
  "@tanstack/react-query": "^5.90.16"  // Recent items caching
}
```

### No New Dependencies Required!

---

## Success Metrics

**Functionality:**
- [ ] Cmd+K opens palette on desktop
- [ ] Long-press FAB opens palette on mobile
- [ ] All voice commands accessible via typing
- [ ] Recent items show last 10 accessed
- [ ] Semantic search returns relevant results
- [ ] Keyboard navigation works (↓↑, Enter, Esc)
- [ ] Mobile gestures work (swipe-down to close)

**Performance:**
- Command results: < 50ms (instant)
- Recent items: < 100ms (cached)
- Semantic search: < 300ms (debounced)
- No UI jank during typing

**Accessibility:**
- WCAG 2.1 AA compliant
- Screen reader announces results
- Keyboard-only navigation works
- Touch targets ≥ 48px on mobile

**User Experience:**
- Opens in < 100ms (no loading spinner needed)
- Auto-focuses search input
- Shows helpful tips for discoverability
- Smooth animations (60fps)

---

## Future Enhancements (Not in Scope)

1. **Command History** - Remember frequently used commands
2. **Custom Commands** - User-defined shortcuts
3. **Calculator Mode** - Type "2+2" for quick math
4. **AI Suggestions** - "You usually review tasks at this time"
5. **Nested Commands** - Multi-step flows (e.g., "New Note" → "In Project X")
6. **Command Aliases** - User defines "nn" → "New Note"

---

## Competitive Analysis

| Feature | Brain Portal | Notion | Obsidian |
|---------|-------------|--------|----------|
| **Keyboard Shortcut** | Cmd+K ✅ | Cmd+K ✅ | Cmd+P ✅ |
| **Mobile Support** | **Long-press FAB** ✅ | ❌ Desktop only | ❌ Clunky on mobile |
| **Voice Integration** | **Unified** ✅ | ❌ | ❌ |
| **Recent Items** | ✅ | ✅ | ✅ |
| **Semantic Search** | **AI-powered** ✅ | Basic ✅ | Plugin-based |
| **Quick Actions** | **2x2 grid** ✅ | Linear list | Linear list |

**Competitive Advantage:** We're the ONLY tool with unified voice + keyboard commands accessible via mobile-friendly long-press. Notion's Cmd+K is desktop-only, Obsidian's mobile command palette is buried in menus.

---

## Risk Assessment

**Low Risk:**
- Extends existing voice infrastructure (no breaking changes)
- Uses battle-tested `cmdk` library
- All data sources already exist (commands, activity log, search API)

**Mitigation:**
- Comprehensive keyboard testing (Windows, Mac, Linux)
- Touch testing on real devices (iOS Safari, Android Chrome)
- Fallback for browsers without haptic API
- Error boundaries around search API calls

---

## Approval

**Ready for Implementation:** ✅

**Estimated Timeline:**
- Phase 1: 1.5 hours
- Phase 2: 2 hours
- Phase 3: 1.5 hours
- Phase 4: 1 hour
- **Total: 6 hours** (with buffer)

**Next Steps:**
1. Create git branch: `feature/command-palette`
2. Implement Phase 1 (foundation)
3. Implement Phase 2 (UI components)
4. Implement Phase 3 (integration)
5. Implement Phase 4 (polish)
6. Test on mobile devices
7. Create PR with demo video

---

**Document Version:** 1.0
**Last Updated:** 2026-01-23
**Author:** Brain Portal Team + Claude Sonnet 4.5
