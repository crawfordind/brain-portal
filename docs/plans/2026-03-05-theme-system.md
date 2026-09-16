# Theme System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a polished theme system with Canvas (light) and Slate (dark) themes — smooth transitions, visual theme picker in settings, and a quick-toggle button in the header.

**Architecture:** TypeScript theme config (`src/lib/themes.ts`) provides metadata; `next-themes` ThemeProvider (added to providers.tsx) writes `class="dark"` to `<html>`; globals.css maps `:root` → Canvas and `.dark` → Slate with crafted OKLCH palettes; a `ThemeToggle` component lives in the header; settings page gets visual theme cards replacing the Select dropdown.

**Tech Stack:** next-themes (already installed), Tailwind CSS v4 + OKLCH color space, React + Next.js App Router, shadcn/ui components

---

### Task 1: Create theme config + unit test

**Files:**
- Create: `src/lib/themes.ts`
- Create: `tests/lib/themes.test.ts`

**Step 1: Write the failing test**

Create `tests/lib/themes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { themes, getThemeById } from "@/lib/themes";

describe("themes config", () => {
  it("has exactly 2 themes", () => {
    expect(themes).toHaveLength(2);
  });

  it("each theme has required fields", () => {
    for (const t of themes) {
      expect(t.id).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(["light", "dark"]).toContain(t.mode);
      expect(t.preview.bg).toBeTruthy();
      expect(t.preview.surface).toBeTruthy();
      expect(t.preview.accent).toBeTruthy();
      expect(t.preview.text).toBeTruthy();
    }
  });

  it("first theme is light mode (Canvas)", () => {
    expect(themes[0].id).toBe("light");
    expect(themes[0].mode).toBe("light");
    expect(themes[0].label).toBe("Canvas");
  });

  it("second theme is dark mode (Slate)", () => {
    expect(themes[1].id).toBe("dark");
    expect(themes[1].mode).toBe("dark");
    expect(themes[1].label).toBe("Slate");
  });

  it("getThemeById returns correct theme", () => {
    expect(getThemeById("light")?.label).toBe("Canvas");
    expect(getThemeById("dark")?.label).toBe("Slate");
    expect(getThemeById("nonexistent")).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/themes.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/themes'"

**Step 3: Create `src/lib/themes.ts`**

```ts
export type ThemeMode = "light" | "dark";

export interface Theme {
  id: string;
  label: string;
  description: string;
  mode: ThemeMode;
  preview: {
    bg: string;
    surface: string;
    accent: string;
    text: string;
  };
}

export const themes: Theme[] = [
  {
    id: "light",
    label: "Canvas",
    description: "Clean & bright",
    mode: "light",
    preview: {
      bg: "#ffffff",
      surface: "#f5f5f5",
      accent: "#2d7a56",
      text: "#1a1a22",
    },
  },
  {
    id: "dark",
    label: "Slate",
    description: "Deep & focused",
    mode: "dark",
    preview: {
      bg: "#1c1c1e",
      surface: "#2a2a2e",
      accent: "#4db6ac",
      text: "#f0f0f5",
    },
  },
];

export function getThemeById(id: string): Theme | undefined {
  return themes.find((t) => t.id === id);
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/lib/themes.test.ts
```

Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add src/lib/themes.ts tests/lib/themes.test.ts
git commit -m "feat: add theme config (Canvas + Slate)"
```

---

### Task 2: Wire up ThemeProvider

**Files:**
- Modify: `src/components/providers.tsx`
- Modify: `src/app/layout.tsx`

**Step 1: Update `src/components/providers.tsx`**

Add `ThemeProvider` import and wrap children. The full new file:

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { OfflineProvider } from "@/components/offline";
import { HydrationErrorLogger } from "@/components/hydration-error-logger";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        themes={["light", "dark"]}
      >
        <HydrationErrorLogger />
        <OfflineProvider>{children}</OfflineProvider>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
```

**Step 2: Update `src/app/layout.tsx`**

Add `suppressHydrationWarning` to `<html>` — next-themes modifies the html element on the client, which causes a React hydration warning without this attribute.

Change line 27 from:
```tsx
<html lang="en" dir="ltr">
```
to:
```tsx
<html lang="en" dir="ltr" suppressHydrationWarning>
```

**Step 3: Verify dev server starts without errors**

```bash
npm run dev
```

Open http://localhost:3000 and open DevTools console. Expected: no hydration warnings.

**Step 4: Commit**

```bash
git add src/components/providers.tsx src/app/layout.tsx
git commit -m "feat: wire up ThemeProvider with next-themes"
```

---

### Task 3: Update globals.css with Canvas + Slate palettes

**Files:**
- Modify: `src/app/globals.css`

**Step 1: Replace the `:root` color variable block (lines 76–109)**

Replace the entire `:root { ... }` block with:

```css
:root {
  --radius: 0.625rem;

  /* ── Canvas (Light Theme) ────────────────────────────────── */
  --background: oklch(1 0 0);
  --foreground: oklch(0.14 0.01 280);
  --card: oklch(0.97 0 0);
  --card-foreground: oklch(0.14 0.01 280);
  --popover: oklch(0.99 0 0);
  --popover-foreground: oklch(0.14 0.01 280);
  --primary: oklch(0.45 0.14 160);
  --primary-foreground: oklch(0.98 0 160);
  --secondary: oklch(0.94 0.01 160);
  --secondary-foreground: oklch(0.30 0.05 160);
  --muted: oklch(0.96 0 0);
  --muted-foreground: oklch(0.50 0.01 280);
  --accent: oklch(0.91 0.04 160);
  --accent-foreground: oklch(0.25 0.05 160);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.90 0 0);
  --input: oklch(0.90 0 0);
  --ring: oklch(0.55 0.14 160);
  --chart-1: oklch(0.55 0.15 160);
  --chart-2: oklch(0.65 0.12 195);
  --chart-3: oklch(0.60 0.10 240);
  --chart-4: oklch(0.70 0.12 130);
  --chart-5: oklch(0.60 0.18 25);
  --sidebar: oklch(0.96 0 0);
  --sidebar-foreground: oklch(0.14 0.01 280);
  --sidebar-primary: oklch(0.45 0.14 160);
  --sidebar-primary-foreground: oklch(0.98 0 160);
  --sidebar-accent: oklch(0.91 0.04 160);
  --sidebar-accent-foreground: oklch(0.25 0.05 160);
  --sidebar-border: oklch(0.90 0 0);
  --sidebar-ring: oklch(0.55 0.14 160);
}
```

**Step 2: Replace the `.dark` color variable block (lines 111–143)**

Replace the entire `.dark { ... }` block with:

```css
.dark {
  /* ── Slate (Dark Theme) ──────────────────────────────────── */
  --background: oklch(0.13 0 0);
  --foreground: oklch(0.95 0.005 280);
  --card: oklch(0.18 0 0);
  --card-foreground: oklch(0.95 0.005 280);
  --popover: oklch(0.16 0 0);
  --popover-foreground: oklch(0.95 0.005 280);
  --primary: oklch(0.68 0.14 175);
  --primary-foreground: oklch(0.10 0.02 175);
  --secondary: oklch(0.20 0.01 175);
  --secondary-foreground: oklch(0.85 0.05 175);
  --muted: oklch(0.20 0 0);
  --muted-foreground: oklch(0.58 0.01 280);
  --accent: oklch(0.23 0.02 175);
  --accent-foreground: oklch(0.88 0.05 175);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(0.25 0.01 280);
  --input: oklch(0.25 0.01 280);
  --ring: oklch(0.68 0.14 175);
  --chart-1: oklch(0.68 0.14 175);
  --chart-2: oklch(0.72 0.12 200);
  --chart-3: oklch(0.65 0.15 150);
  --chart-4: oklch(0.60 0.12 220);
  --chart-5: oklch(0.75 0.10 130);
  --sidebar: oklch(0.11 0 0);
  --sidebar-foreground: oklch(0.85 0.005 280);
  --sidebar-primary: oklch(0.68 0.14 175);
  --sidebar-primary-foreground: oklch(0.10 0.02 175);
  --sidebar-accent: oklch(0.20 0.02 175);
  --sidebar-accent-foreground: oklch(0.85 0.05 175);
  --sidebar-border: oklch(0.22 0.01 280);
  --sidebar-ring: oklch(0.68 0.14 175);
}
```

**Step 3: Add theme transition rule inside `@layer base` (after the existing `body` rule)**

After the `body { @apply bg-background text-foreground; }` line, add:

```css
  /* Smooth color transitions when switching themes */
  *,
  *::before,
  *::after {
    transition-property: color, background-color, border-color, box-shadow, fill, stroke;
    transition-duration: 200ms;
    transition-timing-function: ease;
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      transition: none !important;
    }
  }
```

**Step 4: Fix the broken scrollbar thumb rule (line ~325)**

The current code uses `hsl(var(--border))` but our variables are OKLCH, not HSL. Find and fix these two lines in the `.scrollbar-thin` section:

Change:
```css
    background: hsl(var(--border));
```
to:
```css
    background: var(--border);
```

Change:
```css
    background: hsl(var(--border) / 0.8);
```
to:
```css
    background: var(--border);
    opacity: 0.7;
```

**Step 5: Verify themes look correct**

```bash
npm run dev
```

Open http://localhost:3000. Manually toggle theme via DevTools: in the console run `document.documentElement.classList.toggle('dark')`. You should see the app switch between Canvas (white bg, forest green accents) and Slate (charcoal bg, teal accents) with a smooth 200ms color transition.

**Step 6: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: Canvas + Slate theme palettes with smooth transitions"
```

---

### Task 4: Create ThemeToggle component

**Files:**
- Create: `src/components/theme-toggle.tsx`

**Step 1: Create `src/components/theme-toggle.tsx`**

This is a `"use client"` component. It must be `mounted`-gated to avoid hydration mismatch (the server doesn't know the theme).

```tsx
"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Render a static placeholder before mount to avoid hydration mismatch
  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        aria-label="Toggle theme"
        disabled
      >
        <Sun className="h-4 w-4" />
      </Button>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? "Switch to Canvas (light)" : "Switch to Slate (dark)"}
      aria-label={isDark ? "Switch to Canvas (light)" : "Switch to Slate (dark)"}
    >
      {isDark ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </Button>
  );
}
```

**Step 2: Run TypeScript check**

```bash
npm run typecheck
```

Expected: no errors

**Step 3: Commit**

```bash
git add src/components/theme-toggle.tsx
git commit -m "feat: add ThemeToggle button component"
```

---

### Task 5: Add ThemeToggle to the header

**Files:**
- Modify: `src/components/layout/responsive-layout.tsx`

**Step 1: Add import and insert toggle in header**

At the top of the file, add the import after the existing imports:

```tsx
import { ThemeToggle } from "@/components/theme-toggle";
```

In the header's `ml-auto flex items-center gap-2` div, add `<ThemeToggle />` between the mobile search and the sync indicator:

Find this block (lines 48–53):
```tsx
            <div className="ml-auto flex items-center gap-2">
              <div className="lg:hidden">
                <UnifiedSearch variant="mobile" />
              </div>
              <SyncStatusIndicator />
            </div>
```

Replace with:
```tsx
            <div className="ml-auto flex items-center gap-2">
              <div className="lg:hidden">
                <UnifiedSearch variant="mobile" />
              </div>
              <ThemeToggle />
              <SyncStatusIndicator />
            </div>
```

**Step 2: Verify in browser**

```bash
npm run dev
```

Open http://localhost:3000 (after logging in). You should see a Sun or Moon icon button in the top-right header. Clicking it should switch themes with a smooth 200ms transition.

**Step 3: Run TypeScript check**

```bash
npm run typecheck
```

Expected: no errors

**Step 4: Commit**

```bash
git add src/components/layout/responsive-layout.tsx
git commit -m "feat: add theme toggle button to header"
```

---

### Task 6: Replace settings dropdown with visual theme cards

**Files:**
- Modify: `src/app/(dashboard)/settings/page.tsx`

**Step 1: Update imports**

At the top of the file, add `resolvedTheme` to the `useTheme` destructure, add `cn` utility, and add the `themes` import. Also remove the Select imports since they'll no longer be used.

Remove these imports:
```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
```

Add these imports (after existing imports):
```tsx
import { cn } from "@/lib/utils";
import { themes } from "@/lib/themes";
import { Check } from "lucide-react";
```

Change the `useTheme` destructure from:
```tsx
const { theme, setTheme } = useTheme();
```
to:
```tsx
const { theme, resolvedTheme, setTheme } = useTheme();
```

**Step 2: Replace the Appearance card content**

Find the Appearance `<CardContent>` block (lines 142–178) — it currently has the Select dropdown. Replace the entire `<CardContent className="space-y-4">...</CardContent>` with:

```tsx
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="space-y-0.5">
              <Label className="text-sm md:text-base">Theme</Label>
              <p className="text-xs md:text-sm text-muted-foreground">
                Choose your preferred color scheme
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {themes.map((t) => {
                const isActive = resolvedTheme === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={cn(
                      "relative rounded-xl border-2 p-3 text-left transition-all hover:scale-[1.02] active:scale-[0.98]",
                      isActive
                        ? "border-primary ring-2 ring-primary/20"
                        : "border-border hover:border-primary/40"
                    )}
                    aria-label={`Select ${t.label} theme`}
                    aria-pressed={isActive}
                  >
                    {/* Mini theme preview */}
                    <div
                      className="mb-2.5 h-14 rounded-lg overflow-hidden flex shadow-sm"
                      style={{ background: t.preview.bg }}
                    >
                      {/* Sidebar strip */}
                      <div
                        className="w-8 h-full flex-shrink-0"
                        style={{ background: t.preview.surface }}
                      />
                      {/* Content lines */}
                      <div className="flex-1 p-1.5 flex flex-col gap-1.5 justify-center">
                        <div
                          className="h-1.5 rounded-full"
                          style={{
                            background: t.preview.text,
                            opacity: 0.5,
                            width: "70%",
                          }}
                        />
                        <div
                          className="h-1.5 rounded-full"
                          style={{
                            background: t.preview.text,
                            opacity: 0.3,
                            width: "45%",
                          }}
                        />
                        <div
                          className="h-2.5 rounded mt-1"
                          style={{
                            background: t.preview.accent,
                            width: "40%",
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-xs font-semibold">{t.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      {t.description}
                    </p>
                    {/* Active checkmark */}
                    {isActive && (
                      <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                        <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
                      </div>
                    )}
                  </button>
                );
              })}
              {/* System option */}
              <button
                onClick={() => setTheme("system")}
                className={cn(
                  "relative rounded-xl border-2 p-3 text-left transition-all hover:scale-[1.02] active:scale-[0.98]",
                  theme === "system"
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-border hover:border-primary/40"
                )}
                aria-label="Use system theme"
                aria-pressed={theme === "system"}
              >
                {/* Half-and-half preview */}
                <div className="mb-2.5 h-14 rounded-lg overflow-hidden flex shadow-sm">
                  <div className="w-1/2 h-full bg-white" />
                  <div className="w-1/2 h-full bg-[#1c1c1e]" />
                </div>
                <p className="text-xs font-semibold">System</p>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  Follows OS
                </p>
                {theme === "system" && (
                  <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                    <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
                  </div>
                )}
              </button>
            </div>
          </div>
        </CardContent>
```

**Step 3: Remove unused icon imports**

The `Monitor` icon was only used by the old System select item. Remove it from the lucide-react import line:

Change:
```tsx
import {
  Settings,
  Moon,
  Sun,
  Monitor,
  LogOut,
  Download,
  FileArchive,
  Trash2,
} from "lucide-react";
```

To:
```tsx
import {
  Settings,
  Moon,
  Sun,
  LogOut,
  Download,
  FileArchive,
  Trash2,
} from "lucide-react";
```

Note: `Moon` and `Sun` are still used in the settings page (they might not be after this change). If they're not used anywhere else in the file, remove them too. Check by running typecheck.

**Step 4: Run TypeScript check**

```bash
npm run typecheck
```

Fix any "unused variable" or type errors. If `Moon` and `Sun` are unused after removing the Select, remove them from the import.

**Step 5: Verify in browser**

```bash
npm run dev
```

Navigate to Settings. The Appearance card should show 3 visual theme cards (Canvas, Slate, System). Clicking each should immediately switch the theme with a smooth transition. The active theme shows a checkmark badge.

**Step 6: Run all tests to confirm nothing is broken**

```bash
npm test
```

Expected: all existing tests pass (the theme system changes don't touch tested logic)

**Step 7: Commit**

```bash
git add src/app/(dashboard)/settings/page.tsx
git commit -m "feat: replace theme dropdown with visual theme cards in settings"
```

---

## Done — Manual Verification Checklist

After all tasks complete, verify:

- [ ] App loads without hydration warnings in DevTools console
- [ ] Canvas (light): white background, forest green primary accents, charcoal text
- [ ] Slate (dark): deep charcoal `#1c1c1e` background, teal primary accents, soft white text
- [ ] Switching themes has smooth 200ms color transition (not a flash)
- [ ] System option follows OS dark mode setting
- [ ] Preference persists across page reloads (stored in localStorage by next-themes)
- [ ] ThemeToggle button in header shows Sun (in dark) or Moon (in light) and toggles correctly
- [ ] Settings page shows 3 theme cards with active checkmark
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
