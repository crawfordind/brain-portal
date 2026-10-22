/**
 * Everything the public landing page (/waitlist) claims, as data.
 *
 * Pure and imports nothing, so the page and a test read the same list.
 *
 * Every claim names the files that implement it (`evidence`), and
 * `tests/lib/waitlist/content.test.ts` fails if any of those files is gone.
 * That is the point of this module: the page it replaced advertised a month
 * calendar, a related-notes panel beside the editor, AI tags on "every
 * capture", embeddings for tasks, a Cmd+K that nothing listened for, a
 * one-click Obsidian import with no button, and "38 tools" when there were 52.
 * None of those were lies when someone first wrote them down; they drifted.
 * A claim tied to a file drifts loudly.
 *
 * Counts that can be computed (MCP tools, resources, prompts) are not written
 * here at all: the page reads them from the MCP catalog.
 *
 * House rules for copy: say what it does, not what it is like. No competitor
 * names (their products change and we will not keep up). No numbers we cannot
 * compute. No user counts, testimonials or logos until there are real ones.
 */

export interface Claim {
  title: string;
  body: string;
  /** Repo-relative paths that implement this. Checked by the test suite. */
  evidence: string[];
}

export interface Pillar extends Claim {
  id: string;
  eyebrow: string;
  points: string[];
}

/** The six things the product is for, in the order a day uses them. */
export const PILLARS: Pillar[] = [
  {
    id: "capture",
    eyebrow: "Capture",
    title: "One box for whatever is on your mind.",
    body: "Type, paste or dictate into the Brain Bar. It works out whether you wrote a task, a note, a reminder, a decision, a link or a question, and files it.",
    points: [
      "Quick capture from anywhere with Cmd+Shift+C",
      "Share links and text from your phone's share sheet",
      "Sketch or handwrite, and get the text back",
    ],
    evidence: [
      "src/components/stream/brain-bar.tsx",
      "src/lib/stream/classifier.ts",
      "src/app/manifest.ts",
      "src/components/sketch/sketch-pad.tsx",
      "src/lib/ai/handwriting.ts",
    ],
  },
  {
    id: "find",
    eyebrow: "Find",
    title: "Search by what you meant.",
    body: "Notes are indexed by meaning as well as by words. Ask what you decided about pricing and get the note where you decided it.",
    points: [
      "Cmd+K searches notes, tasks, projects and captures",
      "Notes are summarised, tagged and linked in the background",
      "Text inside PDFs, documents and audio is searchable too",
    ],
    evidence: [
      "src/components/layout/unified-search.tsx",
      "src/lib/ai/embeddings.ts",
      "src/lib/processing/sweep.ts",
      "src/lib/processing/attachments.ts",
    ],
  },
  {
    id: "ask",
    eyebrow: "Ask",
    title: "An AI that starts from your material.",
    body: "Open a chat on any note, task or capture. The answer streams back already holding that item, its project, your highlights on it and your closest related notes.",
    points: [
      "Follow-ups are just the next message",
      "Keep any answer as a note or a task in one tap",
      "Every answer shows which model wrote it and the tokens it used",
    ],
    evidence: [
      "src/hooks/use-ask-about.ts",
      "src/lib/chat/item-context.ts",
      "src/app/api/chat/save/route.ts",
      "src/lib/ai/usage/types.ts",
    ],
  },
  {
    id: "delegate",
    eyebrow: "Delegate",
    title: "Hand off the long jobs. Review what comes back.",
    body: "Send a task, note or project to a background agent. The result arrives as a draft in your review queue, where you approve it, ask for changes or reject it.",
    points: [
      "Runs on a model you choose, or on a Hermes Agent the server connects",
      "Agents propose changes; they don't make them on their own",
      "Every attempt and decision is kept in an audit trail",
    ],
    evidence: [
      "src/lib/agents/runtime/dispatcher.ts",
      "src/lib/agents/runtime/config.ts",
      "src/lib/agents/runtime/envelope.ts",
    ],
  },
  {
    id: "people",
    eyebrow: "People",
    title: "A contact list you never typed.",
    body: "People and companies are picked out of what you write, matched against who you already know, and given a timeline of every mention and every real conversation.",
    points: [
      "Two people with the same first name? It asks which one you meant",
      "Look-alike names are flagged for you, never merged silently",
      "Run several businesses with one contact holding a role in each",
    ],
    evidence: [
      "src/lib/crm/auto-extract.ts",
      "src/lib/crm/touches.ts",
      "src/lib/entities/resolve.ts",
      "src/lib/crm/structure.ts",
    ],
  },
  {
    id: "plan",
    eyebrow: "Plan",
    title: "From thought to done, with the reasons attached.",
    body: "Tasks, projects and a daily operations view built on the same records. Health ratings always say why, and forecasts only appear when there is recent pace to base them on.",
    points: [
      "Project timeline, eight-week workload view and throughput charts",
      "Today view: overdue, blocked, waiting on others, decisions to make",
      "Suggested tasks spotted in your notes, for you to accept or skip",
    ],
    evidence: [
      "src/lib/projects/dashboard.ts",
      "src/lib/operations/types.ts",
      "src/lib/recommendations/scanner.ts",
    ],
  },
];

/** Showcase: one input, the types the classifier actually returns. */
export const BRAIN_BAR_EXAMPLES: { input: string; kind: string; result: string }[] = [
  { input: "Call the supplier about the late order on Friday", kind: "Task", result: "Task, due Friday" },
  { input: "Should we offer annual pricing only?", kind: "Decision", result: "Saved as a decision to make" },
  { input: "https://example.com/research-paper", kind: "Link", result: "Saved; the page is read in the background" },
  { input: "Gut feeling: the onboarding email is too long", kind: "Thought", result: "Kept in your stream" },
  { input: "Remind me to renew the domain tomorrow at 9", kind: "Reminder", result: "Reminder, tomorrow 9:00" },
];

export const AI_CONTROL: Claim[] = [
  {
    title: "Bring your own key",
    body: "Connect OpenRouter in one click, or paste an OpenAI or Claude key. The owner of an instance can also use their ChatGPT plan. Keys are encrypted at rest and never shown again.",
    evidence: ["src/lib/ai/credentials/crypto.ts", "src/lib/ai/credentials/resolve.ts", "src/lib/ai/chatgpt/types.ts"],
  },
  {
    title: "Pick the model for each job",
    body: "Everyday jobs, deep analysis, image reading and search each get their own model, chosen from a live catalog. A retired model is skipped instead of breaking.",
    evidence: ["src/lib/ai/models/slots.ts", "src/lib/ai/models/resolve.ts"],
  },
  {
    title: "See every call",
    body: "A usage log lists what each AI call was for, which model answered, the tokens it read and wrote, and whose key paid.",
    evidence: ["src/lib/ai/usage/types.ts", "src/components/settings/ai-usage-settings.tsx"],
  },
  {
    title: "No silent swaps",
    body: "If your key fails, it says so. It moves on only to your own backup keys, and only to the server's key if you allowed that.",
    evidence: ["src/lib/ai/fallback.ts", "src/lib/ai/credentials/resolve.ts"],
  },
  {
    title: "Your guardrails",
    body: "Write down your values, tone and boundaries once. Background agents read them on every job.",
    evidence: ["src/components/settings/guardrails-settings.tsx", "src/lib/agents/runtime/envelope.ts"],
  },
];

export interface FeatureGroup {
  title: string;
  items: Claim[];
}

/** The full index. Each line is a shipped, reachable feature. */
export const FEATURE_INDEX: FeatureGroup[] = [
  {
    title: "Writing",
    items: [
      { title: "Markdown editor", body: "Markdown shortcuts, a toolbar that stays put on mobile, and a cursor that stays centred as you type.", evidence: ["src/components/editor"] },
      { title: "Note lenses", body: "See the same note as a chart, timeline, checklist or table. Rules pick the view and say why.", evidence: ["src/lib/lenses/choose.ts", "src/components/lenses/note-lenses.tsx"] },
      { title: "[[Wikilinks]]", body: "Links between notes are recorded as connections in the background.", evidence: ["src/lib/processing/local.ts"] },
      { title: "Spell check", body: "On or off per device.", evidence: ["src/hooks/use-editor-spellcheck.ts"] },
    ],
  },
  {
    title: "Tasks and projects",
    items: [
      { title: "Board and calendar", body: "Kanban board, day and week calendar, and a backlog to drag from.", evidence: ["src/components/tasks/calendar/backlog-sidebar.tsx", "src/components/work/work-page.tsx"] },
      { title: "Recurring tasks", body: "Finishing one schedules the next.", evidence: ["src/components/tasks/recurrence-picker.tsx"] },
      { title: "Project trees", body: "Projects inside projects, with health ratings and insights.", evidence: ["src/components/projects/project-tree.tsx", "src/components/projects/project-health-card.tsx"] },
      { title: "Collaborators", body: "Invite editors and viewers to a project.", evidence: ["src/lib/collaborators.ts"] },
      { title: "Intake triage", body: "Loose captures get a suggested home with its reasons. Nothing is filed until you confirm, and every step can be undone.", evidence: ["src/lib/operations/triage.ts"] },
    ],
  },
  {
    title: "Journal",
    items: [
      { title: "One page a day", body: "Ten entry categories, and a monthly compilation of the month's entries.", evidence: ["src/lib/journal/entry.ts", "src/app/api/journal/monthly/route.ts"] },
      { title: "Nothing typed is lost", body: "Entries are saved on your device first and sent when you are back online.", evidence: ["src/lib/journal/outbox.ts"] },
    ],
  },
  {
    title: "Files",
    items: [
      { title: "Attachments", body: "Images, PDFs, Word, Excel and audio. Text is extracted, audio transcribed and images described, so all of it is searchable.", evidence: ["src/lib/storage/upload-policy.ts", "src/lib/processing/attachments.ts"] },
      { title: "Large uploads", body: "Big files go straight to storage instead of failing at a size limit.", evidence: ["src/lib/attachments/upload-client.ts"] },
    ],
  },
  {
    title: "Sharing",
    items: [
      { title: "Share with another account", body: "Give someone on the same instance view or edit access. Remove them and access ends at once.", evidence: ["src/lib/sharing/access.ts", "src/lib/sharing/store.ts"] },
      { title: "Public links", body: "A read-only page for any note. Turn it off or issue a new link at any time.", evidence: ["src/app/shared"] },
    ],
  },
  {
    title: "Everywhere you are",
    items: [
      { title: "Installable app", body: "Add it to your home screen on a phone or computer.", evidence: ["src/app/manifest.ts"] },
      { title: "Works offline", body: "Pages you have opened stay readable. Notes, tasks and quick captures made offline sync when you reconnect.", evidence: ["src/app/sw.ts", "src/lib/offline/simple-queue.ts"] },
      { title: "Voice", body: "Dictate in browsers that support speech input. Uploaded recordings are transcribed.", evidence: ["src/components/ui/voice-input.tsx", "src/lib/processing/attachments.ts"] },
      { title: "Email you can act on", body: "Mark a task done or snooze a reminder straight from the email, with undo.", evidence: ["src/lib/email/action-tokens.ts", "src/lib/email/links.ts"] },
    ],
  },
  {
    title: "Staying on top of it",
    items: [
      { title: "Needs you", body: "The home screen leads with what is waiting on you, and shows nothing when nothing is.", evidence: ["src/components/stream/needs-you.tsx"] },
      { title: "Agent batches fold up", body: "When an agent writes forty notes, your feed shows one line you can open, not forty rows.", evidence: ["src/lib/stream/runs.ts"] },
      { title: "Notifications", body: "In-app and email: due dates, a daily digest and an optional weekly AI report.", evidence: ["src/lib/notifications/engine.ts", "src/lib/notifications/digest.ts"] },
      { title: "It tells you when it breaks", body: "Background failures show up in plain language, with a report you can copy to whoever runs the server.", evidence: ["src/lib/system-health/diagnose.ts"] },
    ],
  },
  {
    title: "Your data",
    items: [
      { title: "Export", body: "Download everything as a ZIP of Markdown files, Obsidian-compatible if you like.", evidence: ["src/components/export/vault-export-dialog.tsx", "src/lib/export/markdown-export.ts"] },
      { title: "Highlights travel", body: "Exported highlights keep their meaning as text, since Markdown has no colour.", evidence: ["src/lib/annotations/extract.ts"] },
    ],
  },
];

/** Security and privacy facts, each a link to the code that does it. */
export const TRUST: Claim[] = [
  {
    title: "No passwords",
    body: "Sign in with an emailed link or a six-digit code. There is no password to reuse, leak or reset.",
    evidence: ["src/lib/auth/magic-link.ts"],
  },
  {
    title: "Sessions hashed at rest",
    body: "Session tokens are stored only as SHA-256 hashes and live in HTTP-only cookies.",
    evidence: ["src/lib/auth/index.ts"],
  },
  {
    title: "AI keys encrypted",
    body: "Your AI keys are sealed with AES-256-GCM and bound to your account. Only a short hint ever reaches a browser.",
    evidence: ["src/lib/ai/credentials/crypto.ts"],
  },
  {
    title: "Closed by default",
    body: "New accounts are created by hand unless the operator opens signups. Your workspace is not one click from a stranger's.",
    evidence: ["src/lib/auth/signup-policy.ts"],
  },
  {
    title: "Scoped AI access",
    body: "Each AI tool key gets only the permissions you tick, its own rate limit and an optional expiry. Sharing a note needs its own permission.",
    evidence: ["src/lib/mcp/keys.ts", "src/mcp/guard.ts"],
  },
  {
    title: "Safe with links",
    body: "Links you save are fetched with checks that stop them reaching private network addresses.",
    evidence: ["src/lib/utils/safe-fetch.ts"],
  },
];

/** What it does not do. Saying so is cheaper than a support ticket. */
export const LIMITS: Claim[] = [
  {
    title: "No native mobile apps",
    body: "It is an installable web app. It works on phones, but it is not in an app store.",
    evidence: ["src/app/manifest.ts"],
  },
  {
    title: "Voice depends on your browser",
    body: "Live dictation uses the browser's speech input, so it works in Chrome and Safari but not everywhere.",
    evidence: ["src/components/ui/voice-input.tsx"],
  },
  {
    title: "Meaning search covers notes",
    body: "Notes are searched by meaning. Captures, tasks and files are found by their words.",
    evidence: ["src/lib/processing/sweep.ts"],
  },
  {
    title: "AI is not free to run",
    body: "AI features need a key: yours, or one the person running this instance provides. Their provider's data policy applies.",
    evidence: ["src/lib/ai/credentials/resolve.ts"],
  },
  {
    title: "Early access",
    body: "It is in active development (version 0.x). Things change, and some edges are rough.",
    evidence: ["package.json"],
  },
];

export const STEPS: { title: string; body: string }[] = [
  {
    title: "Join the list",
    body: "Leave your email. You'll get one confirmation, and nothing else until your spot is ready.",
  },
  {
    title: "Get approved",
    body: "Spots are opened by hand, a few at a time. Your account is created then.",
  },
  {
    title: "Sign in",
    body: "Use the emailed link, or type the six-digit code on any device. No password to set.",
  },
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: "What happens after I join?",
    a: "You get one confirmation email. When your spot opens, your account is created and you get a second email with a sign-in link. Nothing else is sent to your address.",
  },
  {
    q: "Can I run it myself instead?",
    a: "Yes. The full source is public under the AGPL-3.0 license. You need a database (Turso / libSQL), an email account to send sign-in links, and an AI key.",
  },
  {
    q: "Which AI does it use, and who pays?",
    a: "OpenRouter, OpenAI or Claude, with a model you choose for each job. You can connect your own key unless the person running this instance has turned personal keys off; without one, AI runs on the key they provide, if they allow it. A usage log shows every call.",
  },
  {
    q: "Is my writing used to train AI?",
    a: "Brain Portal does not train models. When an AI feature runs, the relevant text is sent to the AI provider that was connected, and that provider's data policy applies. If that matters to you, connect a provider whose policy you trust, or run it yourself.",
  },
  {
    q: "Can I get my data out?",
    a: "Yes. Settings exports everything as a ZIP of Markdown files, readable in any editor and compatible with Obsidian.",
  },
  {
    q: "Does it work with Claude, Cursor or my own agent?",
    a: "Yes. It includes a Model Context Protocol (MCP) server, over local stdio or HTTPS, with keys you scope and can revoke.",
  },
];
