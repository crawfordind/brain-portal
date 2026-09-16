# DC Brain Portal Rebrand Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all user-facing "Brain Portal" text with "DC Brain Portal" (short: "DC") across the app, with no changes to internal class names, package identifiers, or DB schema.

**Architecture:** Surgical targeted edits to ~15 files. Each task touches a logical grouping (metadata, nav, auth, export, services, voice, shared page). No new abstractions needed — pure text replacement with polish mindset.

**Tech Stack:** Next.js 16 App Router, TypeScript, TipTap, Turso, OpenRouter via OpenAI SDK.

---

## String Conventions

| Context | Value |
|---|---|
| Full brand name | `DC Brain Portal` |
| Short name (tight spaces, tabs, nav) | `DC` |
| App tagline / description | `Personal knowledge system` |
| Voice wake phrase | `Hey DC` |
| Export JSON filename prefix | `dc-export-` |
| Export ZIP filename prefix | `dc-vault-` |
| User-Agent | `BrainPortal/1.0` |

---

### Task 1: Core App Metadata

**Files:**
- Modify: `src/app/layout.tsx:16-19`
- Modify: `src/app/manifest.ts:5-7`

**Step 1: Edit layout.tsx metadata**

Replace:
```ts
export const metadata: Metadata = {
  title: "Brain Portal",
  description: "A systems designer's second brain",
};
```

With:
```ts
export const metadata: Metadata = {
  title: "DC Brain Portal",
  description: "Personal knowledge system",
};
```

**Step 2: Edit manifest.ts**

Replace:
```ts
    name: "Brain Portal",
    short_name: "Brain Portal",
    description: "Personal knowledge management with AI",
```

With:
```ts
    name: "DC Brain Portal",
    short_name: "DC",
    description: "Personal knowledge system",
```

**Step 3: Verify**

Start dev server and open browser — tab title should read "DC Brain Portal". Check `<head>` in DevTools to confirm meta description.

**Step 4: Commit**

```bash
git add src/app/layout.tsx src/app/manifest.ts
git commit -m "rebrand: update core app metadata to DC Brain Portal"
```

---

### Task 2: Navigation Branding

**Files:**
- Modify: `src/lib/navigation.ts:82-85`
- Modify: `src/components/layout/responsive-layout.tsx:41`

**Step 1: Update appBranding constant**

In `src/lib/navigation.ts`, replace:
```ts
export const appBranding = {
  name: "Brain Portal",
  icon: Brain,
};
```

With:
```ts
export const appBranding = {
  name: "DC Brain Portal",
  shortName: "DC",
  icon: Brain,
};
```

**Step 2: Update mobile header in responsive-layout.tsx**

Replace:
```tsx
              <span className="font-semibold">Brain Portal</span>
```

With:
```tsx
              <span className="font-semibold">DC</span>
```

Note: The mobile header is the narrow strip at top on phones. "DC" fits cleanly; "DC Brain Portal" would overflow. This matches the `short_name: "DC"` convention.

**Step 3: Verify**

On mobile viewport (or DevTools responsive mode), the header should show the Brain icon + "DC". Check desktop sidebar too — it may also use `appBranding.name`; if so, it renders "DC Brain Portal" at full width.

**Step 4: Check if Sidebar uses appBranding**

Search for `appBranding` usage:
```bash
grep -rn "appBranding" src/
```

If sidebar renders `appBranding.name`, that becomes "DC Brain Portal" automatically.

**Step 5: Commit**

```bash
git add src/lib/navigation.ts src/components/layout/responsive-layout.tsx
git commit -m "rebrand: update navigation branding to DC / DC Brain Portal"
```

---

### Task 3: Login Page

**Files:**
- Modify: `src/app/auth/login/page.tsx:55-58`

**Step 1: Update login card title and description**

Replace:
```tsx
          <CardTitle className="text-2xl">Brain Portal</CardTitle>
          <CardDescription>
            Your systems designer&apos;s second brain
          </CardDescription>
```

With:
```tsx
          <CardTitle className="text-2xl">DC Brain Portal</CardTitle>
          <CardDescription>
            Personal knowledge system
          </CardDescription>
```

**UX note (Apple/Google standard):** The card title is the product name — first thing a new user sees. Keep it clean and exact. The description should orient, not sell; "Personal knowledge system" is factual and clear.

**Step 2: Verify**

Visit `/auth/login` in browser. The card should show the DC icon, "DC Brain Portal" heading, and "Personal knowledge system" subtext.

**Step 3: Commit**

```bash
git add src/app/auth/login/page.tsx
git commit -m "rebrand: update login page title to DC Brain Portal"
```

---

### Task 4: Magic Link Email

**Files:**
- Modify: `src/app/api/auth/login/route.ts:39-59`
- Modify: `src/lib/email/index.ts:34`

**Step 1: Update email subject and body in route.ts**

Replace:
```ts
        subject: "Sign in to Brain Portal",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1a1a1a; margin-bottom: 24px;">Sign in to Brain Portal</h2>
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.5;">Click the button below to sign in to your account:</p>
            <a href="${magicLink}" style="display: inline-block; margin: 24px 0; padding: 14px 28px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 8px; font-weight: 500;">
              Sign In to Brain Portal
            </a>
            <p style="color: #666; font-size: 14px; margin-top: 24px;">
              This link expires in 15 minutes.
            </p>
            <p style="color: #666; font-size: 14px;">
              If you didn't request this email, you can safely ignore it.
            </p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
            <p style="color: #999; font-size: 12px;">
              Brain Portal - Your AI-powered knowledge management system
            </p>
          </div>
        `,
        text: `Sign in to Brain Portal\n\nClick this link to sign in: ${magicLink}\n\nThis link expires in 15 minutes.\n\nIf you didn't request this email, you can safely ignore it.`,
```

With:
```ts
        subject: "Sign in to DC Brain Portal",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1a1a1a; margin-bottom: 24px;">Sign in to DC Brain Portal</h2>
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.5;">Click the button below to sign in to your account:</p>
            <a href="${magicLink}" style="display: inline-block; margin: 24px 0; padding: 14px 28px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 8px; font-weight: 500;">
              Sign In
            </a>
            <p style="color: #666; font-size: 14px; margin-top: 24px;">
              This link expires in 15 minutes.
            </p>
            <p style="color: #666; font-size: 14px;">
              If you didn't request this email, you can safely ignore it.
            </p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
            <p style="color: #999; font-size: 12px;">
              DC Brain Portal — Personal knowledge system
            </p>
          </div>
        `,
        text: `Sign in to DC Brain Portal\n\nClick this link to sign in: ${magicLink}\n\nThis link expires in 15 minutes.\n\nIf you didn't request this email, you can safely ignore it.`,
```

Note: The button label is shortened to just "Sign In" — Apple/Google email UX principle: button labels are actions, not brand names. The brand is already in the heading.

**Step 2: Update email from name in email/index.ts**

Find the line:
```ts
  const fromName = process.env.SMTP_FROM_NAME || "Brain Portal";
```

Replace with:
```ts
  const fromName = process.env.SMTP_FROM_NAME || "DC Brain Portal";
```

**Step 3: Verify**

In development mode (no SMTP configured), trigger a login — the response returns the magic link directly. Check the console for no regressions. To test the email fully, configure SMTP and trigger a login.

**Step 4: Commit**

```bash
git add src/app/api/auth/login/route.ts src/lib/email/index.ts
git commit -m "rebrand: update magic link email to DC Brain Portal"
```

---

### Task 5: Export System

**Files:**
- Modify: `src/lib/export/markdown-export.ts:358-360`
- Modify: `src/app/api/export/markdown/route.ts:103`
- Modify: `src/app/(dashboard)/settings/page.tsx:83,107`

**Step 1: Update vault README header in markdown-export.ts**

Replace:
```ts
  return `# Brain Portal Vault

Exported from [Brain Portal](https://brain-portal.app) on ${exportDate.split("T")[0]}.
```

With:
```ts
  return `# DC Brain Portal Vault

Exported on ${exportDate.split("T")[0]}.
```

Note: URL removed per design decision. Date alone is sufficient context.

**Step 2: Update Content-Disposition filename in route.ts**

Find:
```ts
        "Content-Disposition": `attachment; filename="brain-portal-vault-${dateStr}.zip"`,
```

Replace with:
```ts
        "Content-Disposition": `attachment; filename="dc-vault-${dateStr}.zip"`,
```

**Step 3: Update settings page export filenames**

In `src/app/(dashboard)/settings/page.tsx`:

Replace:
```ts
      a.download = `brain-portal-export-${new Date().toISOString().split("T")[0]}.json`;
```
With:
```ts
      a.download = `dc-export-${new Date().toISOString().split("T")[0]}.json`;
```

Replace:
```ts
      a.download = `brain-portal-vault-${new Date().toISOString().split("T")[0]}.zip`;
```
With:
```ts
      a.download = `dc-vault-${new Date().toISOString().split("T")[0]}.zip`;
```

**Step 4: Update Appearance card description in settings/page.tsx**

Replace:
```tsx
            Customize how Brain Portal looks
```
With:
```tsx
            Customize how DC Brain Portal looks
```

**Step 5: Verify**

Go to `/settings`, trigger a JSON export — confirm file downloads as `dc-export-YYYY-MM-DD.json`. Trigger a vault export — confirm `dc-vault-YYYY-MM-DD.zip`. Unzip it and check the README.md header.

**Step 6: Commit**

```bash
git add src/lib/export/markdown-export.ts src/app/api/export/markdown/route.ts src/app/(dashboard)/settings/page.tsx
git commit -m "rebrand: update export filenames and vault README to DC Brain Portal"
```

---

### Task 6: Services and AI Client

**Files:**
- Modify: `src/lib/services/link-metadata.ts:33`
- Modify: `src/lib/services/link-scraper.ts:43`
- Modify: `src/lib/ai/client.ts:9`

**Step 1: Update User-Agent in link-metadata.ts**

Replace:
```ts
        'User-Agent': 'Mozilla/5.0 (compatible; BrainPortal/1.0; +https://brain-portal.vercel.app)',
```
With:
```ts
        'User-Agent': 'Mozilla/5.0 (compatible; BrainPortal/1.0)',
```

**Step 2: Update User-Agent in link-scraper.ts**

Replace:
```ts
        'User-Agent': 'Mozilla/5.0 (compatible; BrainPortal/1.0; +https://brain-portal.vercel.app)',
```
With:
```ts
        'User-Agent': 'Mozilla/5.0 (compatible; BrainPortal/1.0)',
```

**Step 3: Update X-Title header in ai/client.ts**

Replace:
```ts
    "X-Title": "Brain Portal",
```
With:
```ts
    "X-Title": "DC Brain Portal",
```

**Step 4: Commit**

```bash
git add src/lib/services/link-metadata.ts src/lib/services/link-scraper.ts src/lib/ai/client.ts
git commit -m "rebrand: update User-Agent and AI client headers to DC Brain Portal"
```

---

### Task 7: Voice Wake Phrase

**Files:**
- Modify: `src/components/voice/voice-settings-panel.tsx:191`

**Step 1: Find and update the wake phrase label**

In `src/components/voice/voice-settings-panel.tsx`, replace:
```tsx
                  Say "Hey Brain Portal" to activate (experimental)
```
With:
```tsx
                  Say "Hey DC" to activate (experimental)
```

**Step 2: Verify**

Open the voice settings panel in the UI and confirm the label reads `Say "Hey DC" to activate (experimental)`.

**Step 3: Commit**

```bash
git add src/components/voice/voice-settings-panel.tsx
git commit -m "rebrand: update voice wake phrase to Hey DC"
```

---

### Task 8: Shared Note Page Footer

**Files:**
- Modify: `src/app/shared/[token]/page.tsx:137-154`

**Step 1: Update the footer**

Replace the entire footer block:
```tsx
        <footer className="mt-16 pt-8 border-t border-gray-200">
          <div className="text-center space-y-3">
            <p className="text-gray-600 font-medium">
              Shared with <span className="text-primary font-semibold">Brain Portal</span>
            </p>
            <p className="text-sm text-gray-500">
              Your personal knowledge management system
            </p>
            <a
              href="https://brain-portal.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium"
            >
              Get Brain Portal
            </a>
          </div>
        </footer>
```

With:
```tsx
        <footer className="mt-16 pt-8 border-t border-gray-200">
          <div className="text-center space-y-1">
            <p className="text-sm text-gray-500">
              Shared with <span className="text-gray-700 font-medium">DC Brain Portal</span>
            </p>
          </div>
        </footer>
```

**UX note (Apple/Google standard):** Shared content pages should focus on the content, not promote the product. Apple Notes shared pages have a minimal watermark. Remove the CTA button and URL entirely — the footer is an attribution, not an ad.

**Step 2: Verify**

Share a note, open the share URL. The footer should show only "Shared with DC Brain Portal" — no button, no URL.

**Step 3: Commit**

```bash
git add src/app/shared/[token]/page.tsx
git commit -m "rebrand: update shared note page footer to DC Brain Portal"
```

---

### Task 9: Final Verification Sweep

**Step 1: Search for any remaining Brain Portal references in user-facing code**

```bash
grep -rn "Brain Portal\|brain-portal\|brain_portal\|BrainPortal" src/ \
  --include="*.ts" --include="*.tsx" \
  | grep -v "// " \
  | grep -v "BrainPortalDB" \
  | grep -v "node_modules"
```

Expected: Zero results (or only internal identifiers like `BrainPortalDB` which are intentionally kept).

**Step 2: TypeScript type check**

```bash
npm run typecheck
```

Expected: No errors.

**Step 3: Lint**

```bash
npm run lint
```

Expected: No new lint errors.

**Step 4: Manual smoke test checklist**

- [ ] Browser tab shows "DC Brain Portal"
- [ ] PWA manifest `short_name` = "DC" (check `/manifest.webmanifest` in browser)
- [ ] Mobile header shows "DC"
- [ ] Login page shows "DC Brain Portal" / "Personal knowledge system"
- [ ] Trigger login → email subject says "Sign in to DC Brain Portal"
- [ ] Export JSON → filename is `dc-export-YYYY-MM-DD.json`
- [ ] Export vault → filename is `dc-vault-YYYY-MM-DD.zip`, README says "DC Brain Portal Vault"
- [ ] Settings appearance card says "Customize how DC Brain Portal looks"
- [ ] Voice settings shows `Say "Hey DC" to activate`
- [ ] Shared note footer shows "Shared with DC Brain Portal" (no button, no URL)

**Step 5: Final commit if any stragglers found**

```bash
git add -p
git commit -m "rebrand: final cleanup of remaining Brain Portal references"
```
