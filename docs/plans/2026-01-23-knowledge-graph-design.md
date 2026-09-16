# Knowledge Graph Design Specification

**Date:** January 23, 2026
**Feature:** Interactive Knowledge Graph Visualization
**Estimated Effort:** 6-8 hours
**Status:** Approved for Implementation

---

## Executive Summary

Brain Portal will add an **Interactive Knowledge Graph** at `/graph` that visualizes notes as nodes and connections as edges. This completes the "Third Generation PKM" promise from the market analysis by making AI-discovered connections visible and explorable.

**Key Innovation:** Unlike Obsidian's static graph, Brain Portal's graph will:
- Color-code AI vs manual connections
- Size nodes by connection count (surfacing "hub" notes)
- Show connection strength and reasoning
- Open notes in modal without losing graph context
- Highlight project clusters with color

---

## Design Principles

1. **Force-Directed Physics** - Natural clustering, interactive repositioning
2. **Modal Ecosystem** - Click nodes → preview modal (no navigation away)
3. **Visual Hierarchy** - Size, color, and line style encode meaning
4. **Performance First** - Limit to 200 nodes, lazy load on demand
5. **Mobile-Friendly** - Touch gestures, full-screen on mobile

---

## User Experience

### Page Layout

```
┌─────────────────────────────────────┐
│ 🕸️ Knowledge Graph                 │
│ Explore connections in your notes   │
│                                      │
│ [🔍 Search] [Filter ▾] [Reset] [📸] │ ← Toolbar
├─────────────────────────────────────┤
│                                      │
│          ●──────●                    │
│         /  \   /                     │ ← Force-directed graph
│        ●    ●─●                      │   (canvas fills viewport)
│         \  /                         │
│          ●                           │
│                                      │
│  Legend: ● Note  ─ Connection       │ ← Overlay (bottom-left)
│  Color by project                    │
└─────────────────────────────────────┘
```

### Visual Encoding

**Nodes (Notes):**
- **Size**: Connection count (more = larger)
  - 1-2 connections: Small (radius 5)
  - 3-5 connections: Medium (radius 8)
  - 6+ connections: Large (radius 12)
- **Color**: Project color (from projects table)
  - No project: Gray (#6b7280)
- **Label**: Note title (truncated at 30 chars)
- **Border**:
  - Thicker (2px) for pinned notes
  - Standard (1px) for normal notes

**Links (Connections):**
- **Color by type:**
  - `related`: Blue (#3b82f6)
  - `supports`: Green (#22c55e)
  - `extends`: Orange (#f97316)
  - `contradicts`: Red (#ef4444)
  - `references`: Purple (#a855f7)
- **Width**: Connection strength × 3px
  - strength=0.3 → 0.9px (weak)
  - strength=0.8 → 2.4px (strong)
- **Style**:
  - Solid line if `is_manual=true`
  - Dashed line if `is_manual=false` (AI-generated)

### Interactions

**Click Node:**
```
User clicks note node
    ↓
Modal opens with:
- ModalHeader: Note title + connection count
- Content preview (first 300 chars)
- Connected notes list (with connection types)
- Buttons: "Open Full Note" | "Focus in Graph"
```

**Hover Node:**
- Tooltip shows full title + metadata
- Highlights connected nodes (dim others)
- Shows connection lines in bright colors

**Drag Node:**
- Click + drag to reposition
- Physics engine adjusts other nodes
- Position persists during session (not saved)

**Zoom/Pan:**
- Mouse wheel to zoom in/out
- Click + drag background to pan
- Pinch gesture on mobile

**Double-Click Node:**
- Navigate to full note page (`/notes/[slug]`)
- Alternative to "Open Full Note" button

**Search (Toolbar):**
- Type to filter nodes by title
- Matching nodes highlighted (pulsing border)
- Non-matches dimmed but still visible

**Filter (Toolbar):**
- By project (multi-select dropdown)
- By connection type (checkboxes)
- By pinned status (toggle)

**Reset Button:**
- Re-centers graph
- Resets zoom to fit all nodes
- Clears search/filters

**Screenshot Button:**
- Captures graph as PNG
- Downloads as `knowledge-graph-[date].png`
- Future: Share link, export JSON

### Empty State

If user has no note connections:

```
┌─────────────────────────────────────┐
│   🕸️                                │
│   No connections yet                 │
│                                      │
│   Create connections by:             │
│   • Linking notes with [[wikilinks]] │
│   • AI will suggest connections      │
│   • Manually connect in note editor  │
│                                      │
│   [View All Notes]                   │
└─────────────────────────────────────┘
```

---

## Technical Architecture

### Component Structure

```
src/app/(dashboard)/graph/
└── page.tsx                    # Main graph page (client component)

src/components/graph/
├── knowledge-graph.tsx         # Graph canvas wrapper
├── graph-toolbar.tsx           # Search + filters + controls
├── graph-legend.tsx            # Visual legend overlay
├── note-preview-modal.tsx      # Node click → note preview
├── graph-controls.tsx          # Zoom controls (mobile)
└── index.ts                    # Barrel exports

src/app/api/graph/
└── route.ts                    # GET endpoint for graph data
```

### Data Model

**API Response** (`GET /api/graph`):

```typescript
interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface GraphNode {
  id: string;              // note.id
  title: string;           // note.title
  slug: string;            // note.slug
  projectId: string | null;
  projectName: string | null;
  projectColor: string;    // Default: #6b7280
  connectionCount: number; // For sizing
  isPinned: boolean;       // For border styling
  wordCount: number;       // For tooltip
}

interface GraphLink {
  source: string;          // source_note_id
  target: string;          // target_note_id
  type: 'related' | 'references' | 'extends' | 'contradicts' | 'supports';
  strength: number;        // 0.0 - 1.0
  isManual: boolean;       // true = user, false = AI
  reason: string | null;   // AI explanation
}
```

**SQL Queries:**

```sql
-- Fetch nodes (notes with connection counts)
SELECT
  n.id, n.title, n.slug, n.is_pinned, n.word_count,
  n.project_id, p.name as project_name,
  COALESCE(p.color, '#6b7280') as project_color,
  COUNT(DISTINCT nc.id) as connection_count
FROM notes n
LEFT JOIN projects p ON n.project_id = p.id
LEFT JOIN note_connections nc
  ON n.id = nc.source_note_id OR n.id = nc.target_note_id
WHERE n.user_id = ?
  AND n.is_archived = FALSE
GROUP BY n.id
ORDER BY connection_count DESC, n.updated_at DESC
LIMIT 200;

-- Fetch links (connections between those notes)
SELECT
  source_note_id as source,
  target_note_id as target,
  connection_type as type,
  strength,
  is_manual,
  reason
FROM note_connections
WHERE user_id = ?
  AND source_note_id IN (...)
  AND target_note_id IN (...);
```

### Graph Library Configuration

**Using `react-force-graph-2d`:**

```typescript
import ForceGraph2D from 'react-force-graph-2d';

<ForceGraph2D
  graphData={{ nodes, links }}

  // Node appearance
  nodeLabel={(node) => `${node.title} (${node.connectionCount} connections)`}
  nodeColor={(node) => node.projectColor}
  nodeVal={(node) => node.connectionCount} // Size by connections
  nodeCanvasObject={(node, ctx, globalScale) => {
    // Custom rendering for pinned border, labels, etc.
  }}

  // Link appearance
  linkColor={(link) => connectionTypeColors[link.type]}
  linkWidth={(link) => link.strength * 3}
  linkLineDash={(link) => link.isManual ? null : [5, 5]}
  linkDirectionalParticles={2}  // Animated particles for visual interest

  // Interactions
  onNodeClick={handleNodeClick}
  onNodeHover={handleNodeHover}
  onNodeDrag={handleNodeDrag}
  onBackgroundClick={() => setSelectedNode(null)}

  // Physics
  d3AlphaDecay={0.02}    // Slower decay = more movement
  d3VelocityDecay={0.3}  // Damping
  cooldownTicks={100}    // Initial stabilization

  // Performance
  enableNodeDrag={true}
  enableZoomInteraction={true}
  enablePanInteraction={true}
/>
```

**Color Constants:**

```typescript
const connectionTypeColors = {
  related: '#3b82f6',      // blue-500
  supports: '#22c55e',     // green-500
  extends: '#f97316',      // orange-500
  contradicts: '#ef4444',  // red-500
  references: '#a855f7',   // purple-500
};
```

### Modal Integration

**Note Preview Modal** (reuses existing patterns):

```typescript
// src/components/graph/note-preview-modal.tsx
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ModalHeader, ModalSection, ModalFooter } from '@/components/modals';

interface NotePreviewModalProps {
  node: GraphNode | null;
  connections: GraphLink[];
  onClose: () => void;
  onFocus: (nodeId: string) => void;
}

export function NotePreviewModal({ node, connections, onClose, onFocus }) {
  if (!node) return null;

  const connectedNodes = connections.filter(
    link => link.source === node.id || link.target === node.id
  );

  return (
    <Dialog open={!!node} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="standard">
        <ModalHeader
          title={node.title}
          subtitle={`${node.connectionCount} connections • ${node.wordCount} words`}
          onClose={onClose}
        />

        <ScrollArea className="max-h-[400px]">
          <ModalSection title="Preview">
            {/* Fetch note content via API or show cached snippet */}
            <p className="text-sm text-muted-foreground line-clamp-6">
              {node.contentPreview}
            </p>
          </ModalSection>

          <ModalSection title="Connections" collapsible defaultOpen={true}>
            <div className="space-y-2">
              {connectedNodes.map(conn => (
                <ConnectionItem
                  key={conn.id}
                  connection={conn}
                  onClick={() => onFocus(conn.target)}
                />
              ))}
            </div>
          </ModalSection>
        </ScrollArea>

        <ModalFooter>
          <Button
            onClick={() => router.push(`/notes/${node.slug}`)}
          >
            Open Full Note
          </Button>
          <Button
            variant="outline"
            onClick={() => onFocus(node.id)}
          >
            Focus in Graph
          </Button>
        </ModalFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

## Implementation Plan

### Phase 1: Backend (1.5 hours)

**Step 1.1: Create `/api/graph` endpoint**
- Fetch notes with connection counts
- Fetch connections between those notes
- Transform to `{ nodes, links }` format
- Add caching headers (5min stale)

**Step 1.2: Optimize queries**
- Add composite indexes if needed
- Test with 200+ notes
- Ensure < 500ms response time

### Phase 2: Graph Canvas (2 hours)

**Step 2.1: Create `KnowledgeGraph` component**
- Integrate `react-force-graph-2d`
- Configure node/link appearance
- Add basic interactions (click, hover, drag)

**Step 2.2: Custom node rendering**
- Draw project-colored circles
- Add text labels
- Thicker border for pinned notes
- Scale based on connection count

**Step 2.3: Custom link rendering**
- Color by connection type
- Dashed lines for AI connections
- Width by strength
- Directional particles for flow

### Phase 3: UI Components (2 hours)

**Step 3.1: Graph toolbar**
- Search input (filter nodes by title)
- Project filter dropdown
- Connection type filter
- Reset/center button

**Step 3.2: Graph legend**
- Show color meanings (projects)
- Show line types (manual vs AI)
- Connection type colors
- Collapsible overlay

**Step 3.3: Note preview modal**
- Reuse ModalHeader/Section/Footer
- Fetch note content on demand
- Show connected notes list
- "Open Full" and "Focus" buttons

### Phase 4: Polish (1.5 hours)

**Step 4.1: Mobile optimization**
- Touch gestures (pan, pinch-zoom)
- Full-screen graph on mobile
- Simplified toolbar (hamburger)
- Larger touch targets

**Step 4.2: Performance**
- Memoize graph data transformations
- Debounce search filtering
- Lazy load note content in modal
- Add loading states

**Step 4.3: Empty state**
- Show when no connections exist
- Guide users to create connections
- Link to relevant docs

**Step 4.4: Accessibility**
- Keyboard navigation (Tab to nodes)
- Screen reader labels
- Focus management
- Reduced motion support

---

## Performance Strategy

**Initial Load:**
- Limit to 200 most-connected notes
- If user has > 200 notes, show:
  - Top 150 by connection count
  - Top 50 by recency
- Query optimized with indexes

**Rendering:**
- `react-force-graph-2d` uses canvas (not DOM)
- 60fps with 200+ nodes
- Throttle physics updates during drag

**Data Fetching:**
- React Query with 5min stale time
- Cache graph data in memory
- Fetch note content on modal open (lazy)

**Future Optimizations:**
- Virtual scrolling for connection lists
- Web Workers for graph calculations
- Progressive loading (load clusters)
- IndexedDB cache for offline

---

## Mobile Experience

**Layout:**
- Full-screen graph (no sidebar)
- Toolbar collapses to hamburger menu
- Legend shows as bottom sheet

**Gestures:**
- Single tap node → Preview modal
- Long-press node → Context menu (future)
- Pinch → Zoom in/out
- Two-finger drag → Pan
- Double-tap → Zoom to node

**Optimizations:**
- Larger nodes (min radius 8px)
- Thicker connection lines (min 2px)
- Simplified labels (icons only at far zoom)
- Touch feedback (haptics on tap)

---

## Competitive Positioning

| Feature | Brain Portal | Obsidian | Notion | Roam Research |
|---------|-------------|----------|--------|---------------|
| **Graph View** | ✅ Interactive | ✅ Static | ❌ | ✅ Static |
| **AI Connections** | **✅ Highlighted** | ❌ | ❌ | ❌ |
| **Connection Strength** | **✅ Visual** | ❌ | ❌ | ❌ |
| **Connection Types** | **✅ 5 types** | ❌ | ❌ | ❌ |
| **Modal Preview** | **✅ In-graph** | ❌ Navigates | ❌ | ❌ Navigates |
| **Mobile Graph** | **✅ Touch** | Limited | ❌ | Limited |
| **Project Colors** | **✅ Visual** | ❌ | ❌ | ❌ |

**Unique Selling Points:**
1. **AI vs Manual Distinction** - Dashed lines show AI-discovered connections
2. **Connection Strength Visualization** - Line thickness shows confidence
3. **Typed Connections** - 5 semantic relationships (not just "linked")
4. **Modal-First Exploration** - Stay in graph, preview in modal
5. **Project-Based Clustering** - Visual color coding by project

---

## Future Enhancements (Not in Scope)

1. **Focus Mode**
   - Right-click node → "Focus on this note"
   - Shows only that note + 1-2 degrees of connections
   - Dims rest of graph

2. **Time Slider**
   - Show graph evolution over time
   - Animate connections appearing
   - Filter by date range

3. **3D Graph**
   - Use `react-force-graph-3d` for larger datasets
   - VR/AR support (future)

4. **Collaboration**
   - Show other users' notes (if shared)
   - Real-time collaboration cursors
   - Comments on connections

5. **Export Options**
   - Export as JSON (for external tools)
   - Export as SVG (vector graphics)
   - Export specific clusters

6. **Smart Suggestions**
   - "Missing connections" - AI suggests where to link
   - "Orphan notes" - notes with no connections
   - "Bridge notes" - notes connecting clusters

---

## Success Metrics

**Functionality:**
- [ ] Graph renders with all user notes (up to 200)
- [ ] Nodes sized by connection count
- [ ] Nodes colored by project
- [ ] Lines styled by connection type and source
- [ ] Click node opens preview modal
- [ ] Modal shows note content and connections
- [ ] Search filters nodes by title
- [ ] Filter by project/type works
- [ ] Drag nodes repositions them
- [ ] Zoom/pan works smoothly
- [ ] Empty state shows when no connections

**Performance:**
- [ ] Initial load < 2 seconds
- [ ] Rendering at 60fps (200 nodes)
- [ ] No jank during drag/zoom
- [ ] Modal opens < 300ms

**Mobile:**
- [ ] Touch gestures work (pan, pinch, tap)
- [ ] Full-screen layout on mobile
- [ ] Nodes are tappable (48px+)
- [ ] Modal is mobile-friendly

**Accessibility:**
- [ ] Keyboard navigation works
- [ ] Screen reader announces nodes
- [ ] Focus visible on nodes
- [ ] Reduced motion respected

---

## Risk Assessment

**Low Risk:**
- Library is battle-tested (`react-force-graph-2d`)
- Backend data already exists (`note_connections` table)
- Modal patterns already established
- No new dependencies needed

**Potential Issues:**
- **Performance with > 200 notes**: Mitigated by limit + lazy load
- **Cluttered graph with many connections**: Mitigated by filters + focus mode
- **Mobile UX complexity**: Mitigated by simplified toolbar + gestures

---

## Documentation

- **Design Spec:** `docs/plans/2026-01-23-knowledge-graph-design.md` (this file)
- **Implementation Summary:** To be created after implementation
- **User Guide:** To be created for onboarding

---

**Ready for Implementation! 🎉**

This completes the "Third Generation PKM" feature set promised in the market analysis:
1. ✅ Command Palette - Keyboard power
2. ✅ Smart Inbox - AI proactivity
3. ✅ Knowledge Graph - Visual intelligence

Brain Portal will be the only PKM tool with all three in a mobile-first package.
