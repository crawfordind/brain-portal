# Delegate Modal Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the delegate task modal with gradient avatars, scrollable layout, and modern professional aesthetic.

**Architecture:** Create reusable AgentAvatar component with gradient backgrounds, refactor modal layout to fixed header/footer with scrollable content, update styling for Apple-inspired clean aesthetic.

**Tech Stack:** React, TypeScript, Tailwind CSS, Radix UI Dialog, lucide-react

---

## Task 1: Create Agent Avatar Component

**Files:**
- Create: `src/components/agents/agent-avatar.tsx`
- Create: `src/lib/agents/constants.ts`

**Step 1: Create agent gradient constants**

Create `src/lib/agents/constants.ts`:

```typescript
export const AGENT_GRADIENTS = {
  code: {
    initials: 'AC',
    name: 'Alex Chen',
    from: 'from-blue-500',
    to: 'to-purple-500',
  },
  copy: {
    initials: 'MR',
    name: 'Maya Rodriguez',
    from: 'from-pink-500',
    to: 'to-orange-500',
  },
  research: {
    initials: 'JT',
    name: 'Dr. James Thompson',
    from: 'from-teal-500',
    to: 'to-blue-500',
  },
  marketing: {
    initials: 'RP',
    name: 'Riley Park',
    from: 'from-orange-500',
    to: 'to-red-500',
  },
  analyst: {
    initials: 'PS',
    name: 'Priya Sharma',
    from: 'from-purple-500',
    to: 'to-indigo-500',
  },
  general: {
    initials: 'JL',
    name: 'Jordan Lee',
    from: 'from-green-500',
    to: 'to-teal-500',
  },
  ux: {
    initials: 'JF',
    name: 'Janine Foster',
    from: 'from-pink-500',
    to: 'to-purple-500',
  },
} as const;

export type AgentType = keyof typeof AGENT_GRADIENTS;
```

**Step 2: Create AgentAvatar component**

Create `src/components/agents/agent-avatar.tsx`:

```typescript
import { AGENT_GRADIENTS, type AgentType } from '@/lib/agents/constants';
import { cn } from '@/lib/utils';

interface AgentAvatarProps {
  agentType: AgentType;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-12 w-12 text-sm',
  lg: 'h-16 w-16 text-base',
};

export function AgentAvatar({ agentType, size = 'md', className }: AgentAvatarProps) {
  const config = AGENT_GRADIENTS[agentType];

  return (
    <div
      className={cn(
        'rounded-full bg-gradient-to-br flex items-center justify-center font-bold text-white',
        config.from,
        config.to,
        sizeClasses[size],
        className
      )}
    >
      {config.initials}
    </div>
  );
}
```

**Step 3: Verify component compiles**

Run: `npm run typecheck`
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add src/components/agents/agent-avatar.tsx src/lib/agents/constants.ts
git commit -m "feat(agents): add AgentAvatar component with gradient backgrounds

- Create reusable AgentAvatar component with size variants
- Add AGENT_GRADIENTS constant with initials and gradient colors
- Support sm/md/lg sizes for different contexts"
```

---

## Task 2: Refactor Modal Layout for Scrolling

**Files:**
- Modify: `src/components/tasks/delegate-task-dialog.tsx:138-320`

**Step 1: Update modal structure with fixed header/footer**

In `src/components/tasks/delegate-task-dialog.tsx`, replace the desktop Dialog return (lines 313-320) with:

```typescript
return (
  <Dialog open={open} onOpenChange={onClose}>
    <DialogContent size="standard" className="flex flex-col max-h-[85vh] p-0">
      {/* Fixed Header */}
      <div className="flex-none px-6 pt-6 pb-4 border-b">
        <ModalHeader title="Delegate to AI Agent" onClose={handleClose} showClose={false} />
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
        {formContent}
      </div>

      {/* Fixed Footer */}
      <div className="flex-none px-6 pb-6 pt-4 border-t">
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <Button variant="outline" onClick={handleClose} className="flex-1 sm:flex-initial">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedAgent || !instructions.trim() || isSubmitting}
            className="flex-1 sm:flex-initial"
          >
            {isSubmitting ? 'Delegating...' : 'Delegate to AI'}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
);
```

**Step 2: Remove footer from formContent**

In `src/components/tasks/delegate-task-dialog.tsx`, update formContent (line 138) to remove the footer section (lines 277-289):

```typescript
const formContent = (
  <>
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="text-sm font-medium text-foreground/90">Select AI Agent *</Label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <button
              key={agent.agent_type}
              type="button"
              onClick={() => setSelectedAgent(agent.agent_type)}
              className={`flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-all duration-200 ${
                selectedAgent === agent.agent_type
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border/60 hover:border-primary/50 hover:scale-[1.02]'
              }`}
            >
              <span className="text-2xl">{agent.icon}</span>
              <div className="space-y-1">
                <span className="text-sm font-semibold block">{agent.display_name}</span>
                <span className="text-xs text-muted-foreground block leading-tight line-clamp-2">
                  {agent.description}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="instructions" className="text-sm font-medium text-foreground/90">
          Task Instructions *
        </Label>
        <Textarea
          id="instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="The AI will use this as the prompt..."
          rows={6}
          className="resize-none"
        />
        <p className="text-xs text-muted-foreground">
          Editable prompt sent to the AI agent
        </p>
      </div>

      <div className="border-t pt-4">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
        >
          {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Advanced Options
        </button>
      </div>

      {showAdvanced && (
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="notes" className="text-sm font-medium text-foreground/90">
              Link Reference Notes
            </Label>
            <Select
              value={selectedNoteIds[0] || ''}
              onValueChange={(value) => {
                if (value && !selectedNoteIds.includes(value)) {
                  setSelectedNoteIds([...selectedNoteIds, value]);
                }
              }}
            >
              <SelectTrigger id="notes">
                <SelectValue placeholder="Select notes..." />
              </SelectTrigger>
              <SelectContent className="bg-popover text-foreground !z-[9999]">
                {notes.map((note) => (
                  <SelectItem key={note.id} value={note.id} className="text-foreground">
                    {note.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedNoteIds.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {selectedNoteIds.map((noteId) => {
                  const note = notes.find(n => n.id === noteId);
                  return (
                    <span
                      key={noteId}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-xs"
                    >
                      {note?.title}
                      <button
                        onClick={() => setSelectedNoteIds(selectedNoteIds.filter(id => id !== noteId))}
                        className="hover:text-destructive transition-colors"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="priority" className="text-sm font-medium text-foreground/90">
                Priority
              </Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover text-foreground !z-[9999]">
                  <SelectItem value="low" className="text-foreground">Low</SelectItem>
                  <SelectItem value="medium" className="text-foreground">Medium</SelectItem>
                  <SelectItem value="high" className="text-foreground">High</SelectItem>
                  <SelectItem value="urgent" className="text-foreground">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="format" className="text-sm font-medium text-foreground/90">
                Output Format
              </Label>
              <Select value={outputFormat} onValueChange={setOutputFormat}>
                <SelectTrigger id="format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover text-foreground !z-[9999]">
                  <SelectItem value="markdown" className="text-foreground">Markdown</SelectItem>
                  <SelectItem value="code" className="text-foreground">Code</SelectItem>
                  <SelectItem value="plain_text" className="text-foreground">Plain Text</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            The AI will also use embeddings to find relevant context automatically
          </p>
        </div>
      )}
    </div>
  </>
);
```

**Step 3: Verify component compiles**

Run: `npm run typecheck`
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add src/components/tasks/delegate-task-dialog.tsx
git commit -m "refactor(ui): implement scrollable modal layout with fixed header/footer

- Split modal into fixed header, scrollable content, fixed footer
- Increase spacing from space-y-4 to space-y-6
- Update typography hierarchy with text-foreground/90
- Add transition-all duration-200 to cards
- Remove emoji from advanced options helper text"
```

---

## Task 3: Integrate AgentAvatar Component

**Files:**
- Modify: `src/components/tasks/delegate-task-dialog.tsx:1-162`

**Step 1: Import AgentAvatar and constants**

In `src/components/tasks/delegate-task-dialog.tsx`, add imports at the top:

```typescript
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { AGENT_GRADIENTS, type AgentType } from '@/lib/agents/constants';
```

**Step 2: Replace emoji icon with AgentAvatar**

In `src/components/tasks/delegate-task-dialog.tsx`, update the agent card button (around line 150):

```typescript
<button
  key={agent.agent_type}
  type="button"
  onClick={() => setSelectedAgent(agent.agent_type)}
  className={`flex flex-col items-center gap-3 rounded-lg border p-4 text-center transition-all duration-200 ${
    selectedAgent === agent.agent_type
      ? 'border-primary bg-primary/5 shadow-sm'
      : 'border-border/60 hover:border-primary/50 hover:scale-[1.02]'
  }`}
>
  <AgentAvatar agentType={agent.agent_type as AgentType} size="md" />
  <div className="space-y-1">
    <span className="text-sm font-semibold block">{agent.display_name}</span>
    <span className="text-xs text-muted-foreground block leading-tight line-clamp-2">
      {agent.description}
    </span>
  </div>
</button>
```

**Step 3: Verify component compiles**

Run: `npm run typecheck`
Expected: No TypeScript errors

**Step 4: Test in browser**

Run: `npm run dev`
Navigate to a task and click "Delegate to AI"
Expected: See gradient avatars with initials instead of emoji icons

**Step 5: Commit**

```bash
git add src/components/tasks/delegate-task-dialog.tsx
git commit -m "feat(ui): replace emoji icons with gradient avatars in delegate modal

- Integrate AgentAvatar component into agent selection cards
- Replace emoji icons with 48px gradient avatars showing initials
- Increase card gap to gap-3 for better spacing
- Add line-clamp-2 to descriptions for consistent height"
```

---

## Task 4: Add Custom Scrollbar Styling

**Files:**
- Modify: `tailwind.config.ts`
- Create: `src/app/globals.css` (append)

**Step 1: Add scrollbar plugin to Tailwind config**

In `tailwind.config.ts`, check if tailwind-scrollbar plugin exists. If not, install it:

Run: `npm install -D tailwind-scrollbar`

Then update `tailwind.config.ts` to include the plugin:

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  // ... existing config
  plugins: [
    require("tailwindcss-animate"),
    require("tailwind-scrollbar")({ nocompatible: true }),
  ],
};
export default config;
```

**Step 2: Add custom scrollbar styles**

Append to `src/app/globals.css`:

```css
/* Custom scrollbar for modal content */
.scrollbar-thin {
  scrollbar-width: thin;
}

.scrollbar-thin::-webkit-scrollbar {
  width: 6px;
}

.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}

.scrollbar-thin::-webkit-scrollbar-thumb {
  background: hsl(var(--border));
  border-radius: 3px;
}

.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--border) / 0.8);
}
```

**Step 3: Verify styling works**

Run: `npm run dev`
Navigate to delegate modal and scroll
Expected: Thin, subtle scrollbar appears when content overflows

**Step 4: Commit**

```bash
git add tailwind.config.ts src/app/globals.css package.json package-lock.json
git commit -m "feat(ui): add custom scrollbar styling for modal content

- Install tailwind-scrollbar plugin
- Add thin, rounded scrollbar styles
- Use border color for subtle appearance
- Auto-hide scrollbar on hover"
```

---

## Task 5: Update Mobile Sheet Layout

**Files:**
- Modify: `src/components/tasks/delegate-task-dialog.tsx:292-311`

**Step 1: Update mobile Sheet to match desktop structure**

In `src/components/tasks/delegate-task-dialog.tsx`, update the mobile return (lines 292-311):

```typescript
if (isMobile) {
  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="bottom" className="h-[85vh] p-0 gap-0 flex flex-col">
        {/* Fixed Header */}
        <div className="flex-none p-4 border-b">
          <ModalHeader
            title="Delegate to AI Agent"
            onClose={handleClose}
            showClose={false}
          />
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {formContent}
        </div>

        {/* Fixed Footer */}
        <div className="flex-none p-4 border-t">
          <div className="flex flex-col-reverse gap-2">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!selectedAgent || !instructions.trim() || isSubmitting}
            >
              {isSubmitting ? 'Delegating...' : 'Delegate to AI'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

**Step 2: Verify component compiles**

Run: `npm run typecheck`
Expected: No TypeScript errors

**Step 3: Test mobile layout**

Run: `npm run dev`
Resize browser to mobile width or use dev tools mobile emulation
Navigate to task delegation
Expected: Mobile sheet has same fixed header/footer structure

**Step 4: Commit**

```bash
git add src/components/tasks/delegate-task-dialog.tsx
git commit -m "feat(ui): update mobile sheet layout with fixed header/footer

- Apply same scrollable structure to mobile Sheet
- Ensure consistent UX between desktop Dialog and mobile Sheet
- Add proper flex layout and borders"
```

---

## Task 6: Polish and Final Touches

**Files:**
- Modify: `src/components/tasks/delegate-task-dialog.tsx`

**Step 1: Add subtle box-shadow to header on scroll**

This requires a scroll event listener. Add state and effect in the component:

```typescript
const [isScrolled, setIsScrolled] = useState(false);

// Add after other state declarations
useEffect(() => {
  const handleScroll = (e: Event) => {
    const target = e.target as HTMLDivElement;
    setIsScrolled(target.scrollTop > 0);
  };

  const scrollContainer = document.querySelector('[data-scroll-container]');
  scrollContainer?.addEventListener('scroll', handleScroll);

  return () => {
    scrollContainer?.removeEventListener('scroll', handleScroll);
  };
}, [open]);
```

Update the header div to include conditional shadow:

```typescript
<div className={`flex-none px-6 pt-6 pb-4 border-b transition-shadow ${
  isScrolled ? 'shadow-sm' : ''
}`}>
```

Add data attribute to scrollable content:

```typescript
<div
  data-scroll-container
  className="flex-1 overflow-y-auto px-6 py-4 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent"
>
```

**Step 2: Add React import for useEffect**

At top of file, ensure useEffect is imported:

```typescript
import { useState, useEffect } from 'react';
```

**Step 3: Verify component compiles**

Run: `npm run typecheck`
Expected: No TypeScript errors

**Step 4: Test scroll shadow**

Run: `npm run dev`
Open delegate modal and scroll content
Expected: Subtle shadow appears on header when scrolled

**Step 5: Commit**

```bash
git add src/components/tasks/delegate-task-dialog.tsx
git commit -m "feat(ui): add scroll shadow to modal header

- Add scroll event listener to detect scrolling
- Show subtle shadow on header when content is scrolled
- Add data attribute for scroll container targeting
- Import useEffect for scroll handling"
```

---

## Testing & Verification

**Manual Testing Checklist:**

1. **Desktop Modal:**
   - [ ] Modal opens without overflow
   - [ ] Content scrolls smoothly with custom scrollbar
   - [ ] Header shows shadow when scrolled
   - [ ] All 7 agents show unique gradient avatars
   - [ ] Agent cards have proper hover states (scale, border)
   - [ ] Selected agent has filled background
   - [ ] Footer buttons remain fixed at bottom

2. **Mobile Sheet:**
   - [ ] Sheet opens from bottom
   - [ ] Same scrollable layout as desktop
   - [ ] Gradient avatars visible
   - [ ] Touch scrolling works smoothly

3. **Interactions:**
   - [ ] Can select different agents
   - [ ] Instructions textarea works
   - [ ] Advanced options expand/collapse
   - [ ] Can add/remove linked notes
   - [ ] Form submits successfully
   - [ ] Modal closes properly

4. **Visual Polish:**
   - [ ] Typography hierarchy clear
   - [ ] Spacing feels balanced (space-y-6)
   - [ ] Transitions smooth (200ms)
   - [ ] No emoji icons remain
   - [ ] Border colors subtle (border/60)

**Run full build:**

```bash
npm run build
```

Expected: Build succeeds without errors

---

## Summary

**Total Tasks:** 6
**Estimated Time:** 45-60 minutes
**Key Changes:**
- Created AgentAvatar component with gradient backgrounds
- Refactored modal to fixed header/footer with scrollable content
- Replaced emoji icons with professional gradient avatars
- Added custom scrollbar styling
- Updated spacing and typography for modern aesthetic
- Applied consistent layout to both desktop and mobile

**Files Created:** 2
**Files Modified:** 3
**Commits:** 6
