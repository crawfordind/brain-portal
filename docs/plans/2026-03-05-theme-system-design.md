# Theme System Design

**Date:** 2026-03-05
**Status:** Approved

## Overview

A polished, extensible theme system for Brain Portal featuring two hand-crafted themes: **Canvas** (light) and **Slate** (dark). Designed to feel intentional at every surface — like Notion meets Bear.

## Architecture

### Theme Config (`src/lib/themes.ts`)

Themes are defined as typed TypeScript objects with metadata used for both CSS variable generation and the UI picker. Each theme has an `id`, `label`, `description`, `mode`, and `preview` colors for the picker UI.

```ts
export const themes = [
  { id: "light", label: "Canvas", description: "Clean & bright",  mode: "light", preview: { bg: "#ffffff", accent: "#2d6a4f" } },
  { id: "dark",  label: "Slate",  description: "Deep & focused", mode: "dark",  preview: { bg: "#1c1c1e", accent: "#4db6ac" } },
]
```

### ThemeProvider (`src/components/providers.tsx`)

Add `ThemeProvider` from `next-themes` wrapping the app:
- `attribute="class"` — adds `dark` class to `<html>` (compatible with all existing `dark:` Tailwind utilities)
- `defaultTheme="system"` — respects OS preference on first visit
- `enableSystem={true}` — auto-switches with OS
- `themes={["light", "dark"]}`

### CSS Variable Approach (`src/app/globals.css`)

Replace existing color variable blocks with the new palette. Two blocks:
- `:root` → Canvas (light) theme variables
- `.dark` → Slate (dark) theme variables

Smooth transitions added globally (200ms, respects `prefers-reduced-motion`).

### Existing Tailwind `dark:` utilities

All existing `dark:` class utilities continue to work without changes — the `ThemeProvider` adds/removes the `dark` class on `<html>`.

## Color Palettes

### Canvas (Light)

| Token | Value | Description |
|-------|-------|-------------|
| `--background` | `oklch(1.00 0 0)` | Pure white |
| `--card` | `oklch(0.97 0 0)` | Barely-there off-white |
| `--sidebar-background` | `oklch(0.96 0 0)` | Subtle depth layer |
| `--foreground` | `oklch(0.14 0.01 280)` | Rich charcoal ink |
| `--muted-foreground` | `oklch(0.50 0.01 280)` | Secondary gray |
| `--border` | `oklch(0.90 0 0)` | Airy dividers |
| `--primary` | `oklch(0.45 0.14 160)` | Deep forest green |
| `--primary-foreground` | `oklch(0.98 0 160)` | White on green |
| `--accent` | `oklch(0.91 0.04 160)` | Soft sage tint |
| `--ring` | `oklch(0.55 0.14 160)` | Forest focus ring |
| `--secondary` | `oklch(0.94 0.01 160)` | Light green secondary |
| `--muted` | `oklch(0.96 0 0)` | Muted surface |

### Slate (Dark)

| Token | Value | Description |
|-------|-------|-------------|
| `--background` | `oklch(0.13 0 0)` | True charcoal (#1c1c1e equiv) |
| `--card` | `oklch(0.18 0 0)` | Elevated surface |
| `--sidebar-background` | `oklch(0.11 0 0)` | Deeper sidebar |
| `--foreground` | `oklch(0.95 0.005 280)` | Soft near-white |
| `--muted-foreground` | `oklch(0.58 0.01 280)` | Secondary gray |
| `--border` | `oklch(0.25 0.01 280)` | Subtle dark dividers |
| `--primary` | `oklch(0.68 0.14 175)` | Vibrant teal |
| `--primary-foreground` | `oklch(0.10 0.02 175)` | Dark text on teal |
| `--accent` | `oklch(0.23 0.02 175)` | Dark teal hover states |
| `--ring` | `oklch(0.68 0.14 175)` | Teal focus ring |
| `--secondary` | `oklch(0.20 0.01 175)` | Dark teal secondary |
| `--muted` | `oklch(0.20 0 0)` | Muted surface |

## Special Details

### Smooth Transitions
```css
*, *::before, *::after {
  transition: color 200ms ease, background-color 200ms ease,
              border-color 200ms ease, box-shadow 200ms ease;
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none; }
}
```

### Custom Scrollbars
- Width: 6px (thin, unobtrusive)
- Track: matches background color
- Thumb: matches muted border color
- Hover: matches primary color

### Chart Colors
Both themes get a full set of 5 chart colors harmonized with the accent palette.

## UI Components

### Settings Page — Theme Cards

Replace the existing Select dropdown with two side-by-side theme cards:
- Mini preview (sidebar strip + main area + accent dot)
- Theme name and description
- Active state: ring + checkmark badge in primary color
- Hover state: subtle scale transform

### Header Toggle Button

A compact `Sun` / `Moon` icon button in the sticky header (responsive layout):
- Toggles between Canvas and Slate
- Smooth icon swap animation
- Tooltip with theme name
- Located near the search/sync area in the header

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/lib/themes.ts` | Create — theme config |
| `src/app/globals.css` | Modify — replace color variables |
| `src/components/providers.tsx` | Modify — add ThemeProvider |
| `src/app/layout.tsx` | Modify — add suppressHydrationWarning |
| `src/app/(dashboard)/settings/page.tsx` | Modify — replace Select with theme cards |
| `src/components/theme-toggle.tsx` | Create — header toggle button |
| `src/components/layout/responsive-layout.tsx` | Modify — add toggle to header |

## Non-Goals

- More than 2 themes in this iteration
- Per-user theme persistence beyond localStorage (next-themes handles this)
- Custom theme builder / color picker
