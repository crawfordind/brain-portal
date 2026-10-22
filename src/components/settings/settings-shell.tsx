"use client";

/**
 * Settings, organised the way a large preferences surface has to be.
 *
 * Desktop: a sidebar of named groups with a search box, and one section at a
 * time beside it. Phone: the same list, larger, as the whole page; tapping a
 * row opens that section with a back button to the list.
 *
 * Which section is open lives in the URL hash, so the browser's back button,
 * a reload and every existing `/settings#notifications` link all do the right
 * thing. It is read through `useSyncExternalStore`, which keeps the server
 * render (no hash) and the client render honest without an effect.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import {
  BarChart3,
  Bell,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Database,
  KeyRound,
  Mic,
  Palette,
  PenLine,
  Plug,
  Search,
  Sparkles,
  User,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SECTION_ID,
  getSection,
  groupSections,
  resolveSectionId,
  searchSections,
  type SettingsSectionId,
} from "@/lib/settings/sections";
import { NotificationPreferencesPanel } from "@/components/notifications/notification-preferences";
import { VoiceSettingsPanel } from "@/components/voice";
import { AiProviderSettingsPanel } from "./ai-provider-settings";
import { AiUsageSettingsPanel } from "./ai-usage-settings";
import { GuardrailsSettingsPanel } from "./guardrails-settings";
import { McpKeysPanel } from "./mcp-keys-panel";
import { ModelSettingsPanel } from "./model-settings";
import { SharingSettingsPanel } from "./sharing-settings";
import { AccountSection, type SettingsAccount } from "./sections/account-section";
import { AppearanceSection } from "./sections/appearance-section";
import { DataSection } from "./sections/data-section";
import { EditorSection } from "./sections/editor-section";

const ICONS: Record<SettingsSectionId, ComponentType<{ className?: string }>> = {
  account: User,
  notifications: Bell,
  sharing: Users,
  appearance: Palette,
  editor: PenLine,
  voice: Mic,
  "ai-provider": KeyRound,
  "ai-models": Cpu,
  "ai-guardrails": Sparkles,
  "ai-usage": BarChart3,
  "api-access": Plug,
  data: Database,
};

function renderSection(id: SettingsSectionId, account: SettingsAccount): ReactNode {
  switch (id) {
    case "account":
      return <AccountSection account={account} />;
    case "notifications":
      return <NotificationPreferencesPanel />;
    case "sharing":
      return <SharingSettingsPanel />;
    case "appearance":
      return <AppearanceSection />;
    case "editor":
      return <EditorSection />;
    case "voice":
      return <VoiceSettingsPanel embedded />;
    case "ai-provider":
      return <AiProviderSettingsPanel />;
    case "ai-models":
      return <ModelSettingsPanel />;
    case "ai-guardrails":
      return <GuardrailsSettingsPanel />;
    case "ai-usage":
      return <AiUsageSettingsPanel />;
    case "api-access":
      return <McpKeysPanel />;
    case "data":
      return <DataSection />;
  }
}

// ── The URL hash as an external store ────────────────────────────────────────

const HASH_CLEARED_EVENT = "bp:settings-hash-cleared";

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  window.addEventListener(HASH_CLEARED_EVENT, onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(HASH_CLEARED_EVENT, onChange);
  };
}
const getHash = () => window.location.hash;
const getServerHash = () => "";

function openSection(id: SettingsSectionId) {
  window.location.hash = id;
}

function closeSection() {
  // Drop the hash without leaving "#" behind; pushState fires no event itself.
  window.history.pushState(null, "", window.location.pathname + window.location.search);
  window.dispatchEvent(new Event(HASH_CLEARED_EVENT));
}

// ── Navigation ───────────────────────────────────────────────────────────────

function SettingsNav({
  activeId,
  onOpen,
}: {
  activeId: SettingsSectionId;
  onOpen: (id: SettingsSectionId) => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchSections(query), [query]);
  const groups = useMemo(() => groupSections(results), [results]);

  return (
    <nav aria-label="Settings sections" className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) {
              event.preventDefault();
              onOpen(results[0].id as SettingsSectionId);
            } else if (event.key === "Escape" && query) {
              event.preventDefault();
              setQuery("");
            }
          }}
          placeholder="Search settings"
          aria-label="Search settings"
          className={cn(
            "h-11 w-full rounded-xl border bg-card pl-9 pr-9 text-base md:h-9 md:rounded-lg md:text-sm",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "[&::-webkit-search-cancel-button]:hidden"
          )}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground md:h-9 md:w-9"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {groups.length === 0 && (
        <p className="px-1 text-sm text-muted-foreground">
          No settings match &ldquo;{query}&rdquo;.
        </p>
      )}

      {groups.map((group) => (
        <div key={group.id} className="space-y-1.5">
          <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:px-2.5">
            {group.label}
          </h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card md:divide-y-0 md:rounded-none md:border-0 md:bg-transparent">
            {group.sections.map((section) => {
              const id = section.id as SettingsSectionId;
              const Icon = ICONS[id];
              const active = id === activeId;
              return (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      onOpen(id);
                    }}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-3 px-3 py-2.5 transition-colors",
                      "min-h-14 md:min-h-9 md:rounded-lg md:px-2.5 md:py-1.5",
                      "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      active && "md:bg-primary/10 md:text-primary md:hover:bg-primary/10"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground md:h-auto md:w-auto md:bg-transparent",
                        active ? "md:text-primary" : "md:text-muted-foreground md:group-hover:text-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{section.label}</span>
                      <span className="block truncate text-xs text-muted-foreground md:hidden">
                        {section.description}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 md:hidden" />
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

// ── Shell ────────────────────────────────────────────────────────────────────

export function SettingsShell({ account }: { account: SettingsAccount }) {
  const hash = useSyncExternalStore(subscribeHash, getHash, getServerHash);
  const requestedId = resolveSectionId(hash);
  // Desktop always shows a section; a phone shows the list until one is chosen.
  const shownId = requestedId ?? DEFAULT_SECTION_ID;
  const section = getSection(shownId);
  const Icon = ICONS[shownId];

  // Set when a section was opened from the list on this page, so "back" can
  // pop that history entry instead of stacking a new one.
  const openedFromList = useRef(false);
  // Set by a click, so focus moves to the new section's heading for keyboard
  // and screen-reader users, but a page load or a back press leaves it alone.
  const focusHeading = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const handleOpen = useCallback((id: SettingsSectionId) => {
    if (window.location.hash === `#${id}`) return;
    openedFromList.current = true;
    focusHeading.current = true;
    openSection(id);
  }, []);

  const handleBack = useCallback(() => {
    if (openedFromList.current) {
      openedFromList.current = false;
      window.history.back();
    } else {
      closeSection();
    }
  }, []);

  // A new section starts at its top, wherever the last one was scrolled to.
  // The layout scrolls <main>, not the window.
  useEffect(() => {
    if (!requestedId) return;
    document.querySelector("main")?.scrollTo({ top: 0 });
    if (focusHeading.current) {
      focusHeading.current = false;
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [requestedId]);

  return (
    <div className="md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
      <aside
        className={cn(
          "space-y-4 md:sticky md:top-0 md:block md:self-start md:pb-6",
          requestedId && "hidden"
        )}
      >
        <div className="px-1 md:px-2.5">
          <h1 className="text-xl font-bold md:text-lg">Settings</h1>
          <p className="text-sm text-muted-foreground md:hidden">
            Your account, preferences and AI, in one place.
          </p>
        </div>
        <SettingsNav activeId={shownId} onOpen={handleOpen} />
      </aside>

      <section
        aria-labelledby="settings-section-title"
        className={cn("min-w-0 md:block", !requestedId && "hidden")}
      >
        <button
          type="button"
          onClick={handleBack}
          className="-ml-2 mb-2 flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-primary hover:bg-muted/60 md:hidden"
        >
          <ChevronLeft className="h-4 w-4" />
          Settings
        </button>

        <header className="mb-6 flex items-start gap-3 border-b pb-4">
          <span className="mt-0.5 hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary md:flex">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2
              id="settings-section-title"
              ref={headingRef}
              tabIndex={-1}
              className="text-xl font-semibold tracking-tight focus:outline-none"
            >
              {section.label}
            </h2>
            <p className="text-sm text-muted-foreground">{section.description}</p>
          </div>
        </header>

        <div key={shownId} className="animate-in fade-in duration-150">
          {renderSection(shownId, account)}
        </div>
      </section>
    </div>
  );
}
