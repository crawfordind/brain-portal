"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  ArrowRight,
  Brain,
  Check,
  ChevronDown,
  CircleAlert,
  Code2,
  Command,
  FileText,
  Lock,
  MessageSquare,
  Network,
  Search,
  Send,
  Sparkles,
  Users,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { ANNOTATION_INTENTS } from "@/lib/annotations/intents";
import {
  AI_CONTROL,
  BRAIN_BAR_EXAMPLES,
  FAQ,
  FEATURE_INDEX,
  LIMITS,
  PILLARS,
  STEPS,
  TRUST,
} from "@/lib/waitlist/content";

/**
 * The public landing page. All copy comes from `src/lib/waitlist/content.ts`
 * (each claim is tied to the code that implements it); this file only draws.
 *
 * Content is visible without JavaScript and without motion: the old page
 * started every section at opacity 0 and revealed it on scroll, so a crawler,
 * a reader with scripts off, or one who prefers reduced motion saw a black
 * page. Motion here is decoration on top of a page that already reads.
 */

export interface WaitlistLandingProps {
  /** SIGNUP_MODE=open: offer sign-up instead of a list nobody reviews. */
  signupOpen: boolean;
  /** False under AI_KEY_POLICY=server_only, where personal keys are not used. */
  personalKeys: boolean;
  sourceUrl: string;
  mcp: { tools: number; resources: number; prompts: number; examples: string[] };
}

const PILLAR_ICONS: Record<string, LucideIcon> = {
  capture: Command,
  find: Search,
  ask: MessageSquare,
  delegate: Send,
  people: Users,
  plan: Waypoints,
};

function cn(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true
  );
}

/* ─── Join form ─────────────────────────────────────────────── */

function JoinForm({ signupOpen, id }: { signupOpen: boolean; id?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (state === "loading" || state === "done") return;
      setState("loading");
      setErrorMsg("");
      try {
        const res = await fetch("/api/waitlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setErrorMsg(data.error || "Something went wrong. Please try again.");
          setState("error");
        } else {
          setState("done");
        }
      } catch {
        setErrorMsg("Couldn't reach the server. Check your connection and try again.");
        setState("error");
      }
    },
    [email, state]
  );

  if (signupOpen) {
    return (
      <div id={id} className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <a
          href="/auth/login"
          className="inline-flex h-12 items-center gap-2 rounded-xl bg-teal-500 px-6 text-sm font-semibold text-[#04110f] transition hover:bg-teal-400"
        >
          Create your account <ArrowRight className="h-4 w-4" aria-hidden />
        </a>
        <span className="text-xs text-white/60">Sign up with your email. No password.</span>
      </div>
    );
  }

  if (state === "done") {
    return (
      <div
        id={id}
        role="status"
        className="flex items-start gap-3 rounded-xl border border-teal-400/30 bg-teal-400/10 px-5 py-4 text-left"
      >
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-400 text-[#04110f]">
          <Check className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-semibold text-teal-100">You&apos;re on the list.</p>
          <p className="mt-0.5 text-sm text-teal-100/75">
            If {email.trim()} is new to us, a confirmation is on its way. When your spot opens you&apos;ll get a
            sign-in link at the same address.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form id={id} onSubmit={submit} className="w-full">
      <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-1.5 sm:flex-row">
        <label htmlFor={`${id ?? "join"}-email`} className="sr-only">
          Email address
        </label>
        <input
          id={`${id ?? "join"}-email`}
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "error") setState("idle");
          }}
          placeholder="you@example.com"
          aria-invalid={state === "error"}
          aria-describedby={state === "error" ? `${id ?? "join"}-error` : undefined}
          className="h-12 min-w-0 flex-1 rounded-xl bg-transparent px-4 text-[15px] text-white outline-none placeholder:text-white/40 focus-visible:ring-2 focus-visible:ring-teal-400/60"
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-teal-500 px-6 text-sm font-semibold text-[#04110f] transition hover:bg-teal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200 active:scale-[0.98] disabled:opacity-70"
        >
          {state === "loading" ? "Joining…" : "Join the waitlist"}
          {state !== "loading" && <ArrowRight className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      {state === "error" && (
        <p id={`${id ?? "join"}-error`} role="alert" className="mt-2 text-left text-sm text-rose-300">
          {errorMsg}
        </p>
      )}
    </form>
  );
}

/* ─── Brain Bar demo ────────────────────────────────────────── */

function BrainBarDemo() {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState(0);
  const example = BRAIN_BAR_EXAMPLES[index];
  const done = reduced || typed >= example.input.length;

  useEffect(() => {
    if (reduced) return;
    const timer = done
      ? setTimeout(() => {
          setIndex((i) => (i + 1) % BRAIN_BAR_EXAMPLES.length);
          setTyped(0);
        }, 2600)
      : setTimeout(() => setTyped((t) => t + 1), 32);
    return () => clearTimeout(timer);
  }, [reduced, done, typed]);

  return (
    <figure className="relative mx-auto w-full max-w-2xl">
      <div
        aria-hidden
        className="absolute -inset-px rounded-[22px] bg-gradient-to-b from-teal-300/40 via-white/10 to-transparent"
      />
      <div className="relative rounded-[21px] bg-[#0c0c14] p-4 shadow-2xl shadow-teal-950/40 sm:p-5">
        <div aria-hidden className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5">
          <Sparkles className="h-4 w-4 shrink-0 text-teal-300" />
          <span className="min-w-0 flex-1 truncate text-left text-[15px] text-white/90">
            {reduced ? example.input : example.input.slice(0, typed)}
            {!done && <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-pulse bg-teal-300" />}
          </span>
          <kbd className="hidden rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white/50 sm:inline">
            Enter
          </kbd>
        </div>
        <div
          aria-hidden
          className={cn(
            "mt-3 flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm transition-opacity duration-300",
            done ? "bg-teal-400/[0.08] opacity-100" : "opacity-0"
          )}
        >
          <span className="inline-flex items-center gap-2">
            <span className="rounded-full bg-teal-400/15 px-2.5 py-0.5 text-xs font-medium text-teal-200">
              {example.kind}
            </span>
            <span className="text-white/75">{example.result}</span>
          </span>
          <Check className="h-4 w-4 text-teal-300" />
        </div>
        {/* What the animation shows, for anyone not watching it. */}
        <ul className="sr-only">
          {BRAIN_BAR_EXAMPLES.map((e) => (
            <li key={e.input}>
              Typing &ldquo;{e.input}&rdquo; is filed as: {e.kind}. {e.result}.
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="mt-3 text-center text-xs text-white/45">
        Illustration of the Brain Bar. Examples, not live data.
      </figcaption>
    </figure>
  );
}

/* ─── Highlight-to-instruct demo ────────────────────────────── */

function HighlightDemo() {
  const [active, setActive] = useState(ANNOTATION_INTENTS[1]?.id ?? "edit");
  const intent = ANNOTATION_INTENTS.find((i) => i.id === active) ?? ANNOTATION_INTENTS[0];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-7">
      <p className="text-[17px] leading-relaxed text-white/80 sm:text-lg">
        Our onboarding takes four screens.{" "}
        <mark
          className="rounded px-1 py-0.5 text-white transition-colors"
          style={{ background: `${intent.swatch}40`, boxShadow: `inset 0 -2px 0 ${intent.swatch}` }}
        >
          Most people quit on the second one, where we ask for a phone number.
        </mark>{" "}
        Removing it is the obvious fix.
      </p>
      <div role="radiogroup" aria-label="Highlight colour" className="mt-6 flex flex-wrap gap-2">
        {ANNOTATION_INTENTS.map((i) => (
          <button
            key={i.id}
            type="button"
            role="radio"
            aria-checked={i.id === active}
            onClick={() => setActive(i.id)}
            className={cn(
              "inline-flex min-h-[40px] items-center gap-2 rounded-full border px-3 text-sm transition",
              i.id === active
                ? "border-white/40 bg-white/10 text-white"
                : "border-white/10 text-white/65 hover:border-white/25 hover:text-white"
            )}
          >
            <span className="h-3 w-3 rounded-full" style={{ background: i.swatch }} aria-hidden />
            {i.label}
          </button>
        ))}
      </div>
      <p className="mt-5 text-sm text-white/70" aria-live="polite">
        <span className="font-medium text-white">{intent.label}:</span> {intent.meaning.replace(/\s*\u2014\s*/g, ", ")}
      </p>
    </div>
  );
}

/* ─── Small building blocks ─────────────────────────────────── */

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: ReactNode; body?: string }) {
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center md:mb-16">
      <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-teal-300">{eyebrow}</p>
      <h2 className="text-balance text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl md:text-5xl">
        {title}
      </h2>
      {body && <p className="mt-5 text-pretty text-base leading-relaxed text-white/65 md:text-lg">{body}</p>}
    </div>
  );
}

function Gradient({ children }: { children: ReactNode }) {
  return (
    <span className="bg-gradient-to-r from-teal-200 via-teal-300 to-emerald-300 bg-clip-text text-transparent">
      {children}
    </span>
  );
}

function codeLink(sourceUrl: string, path: string) {
  return `${sourceUrl}/blob/main/${path}`;
}

/* ─── Page ──────────────────────────────────────────────────── */

export function WaitlistLanding({ signupOpen, personalKeys, sourceUrl, mcp }: WaitlistLandingProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const ctaLabel = signupOpen ? "Get started" : "Join the waitlist";
  const ctaHref = signupOpen ? "/auth/login" : "#join";

  return (
    <div className="min-h-dvh overflow-x-clip bg-[#07070c] font-sans text-white antialiased selection:bg-teal-400/30">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-black"
      >
        Skip to content
      </a>

      {/* ── Nav ─────────────────────────────────────────── */}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
          scrolled ? "border-b border-white/[0.07] bg-[#07070c]/85 backdrop-blur-md" : "bg-transparent"
        )}
      >
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-8" aria-label="Main">
          <a href="#top" className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-teal-600 to-teal-300">
              <Brain className="h-4 w-4 text-[#04110f]" aria-hidden />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">Brain Portal</span>
          </a>
          <div className="hidden items-center gap-7 text-sm text-white/65 md:flex">
            <a href="#product" className="transition hover:text-white">Product</a>
            <a href="#ai" className="transition hover:text-white">Your AI</a>
            <a href="#trust" className="transition hover:text-white">Trust</a>
            <a href="#faq" className="transition hover:text-white">FAQ</a>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <a href="/auth/login" className="rounded-lg px-3 py-2 text-sm text-white/75 transition hover:text-white">
              Sign in
            </a>
            <a
              href={ctaHref}
              className="rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-[#07070c] transition hover:bg-teal-100"
            >
              <span className="sm:hidden">{signupOpen ? "Start" : "Join"}</span>
              <span className="hidden sm:inline">{ctaLabel}</span>
            </a>
          </div>
        </nav>
      </header>

      <main id="main">
        {/* ── Hero ───────────────────────────────────────── */}
        <section id="top" className="relative px-4 pb-20 pt-32 sm:px-8 md:pb-28 md:pt-40">
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute left-1/2 top-[-18rem] h-[42rem] w-[72rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(45,212,191,0.18),transparent)]" />
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]" />
          </div>

          <div className="relative mx-auto max-w-4xl text-center">
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs text-white/75 transition hover:border-teal-300/40 hover:text-white"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-teal-300" aria-hidden />
              Early access
              <span className="text-white/30" aria-hidden>|</span>
              Open source, AGPL-3.0
              <ArrowRight className="h-3 w-3" aria-hidden />
            </a>

            <h1 className="text-balance text-5xl font-semibold leading-[0.98] tracking-[-0.045em] sm:text-6xl md:text-7xl lg:text-[88px]">
              Think it. Keep it.
              <br />
              <Gradient>Put it to work.</Gradient>
            </h1>

            <p className="mx-auto mt-7 max-w-2xl text-pretty text-lg leading-relaxed text-white/70 md:text-xl">
              One box for every thought. Search that finds what you meant. An AI that starts from what you
              wrote, and agents whose work waits for your approval. Notes, tasks, projects and people, in one
              open-source workspace.
            </p>

            <div className="mx-auto mt-10 max-w-lg" id="join">
              <JoinForm signupOpen={signupOpen} id="hero-join" />
              {!signupOpen && (
                <p className="mt-3 text-sm text-white/55">
                  One confirmation now, one sign-in link when your spot opens. Nothing else.
                </p>
              )}
            </div>
          </div>

          <div className="relative mt-16 md:mt-20">
            <BrainBarDemo />
          </div>
        </section>

        {/* ── Facts ──────────────────────────────────────── */}
        <section aria-label="At a glance" className="border-y border-white/[0.06] bg-white/[0.015] px-4 sm:px-8">
          <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-y-8 py-10 md:grid-cols-4 md:py-12">
            {[
              { value: "AGPL-3.0", label: "Every line is public", href: `${sourceUrl}/blob/main/LICENSE` },
              { value: String(mcp.tools), label: "Tools your AI agents can call", href: "#mcp" },
              personalKeys
                ? { value: "Your key", label: "OpenRouter, OpenAI or Claude", href: "#ai" }
                : { value: "Per job", label: "Choose the AI model for each job", href: "#ai" },
              { value: "0", label: "Passwords to remember", href: "#trust" },
            ].map((f) => (
              <li key={f.label}>
                <a
                  href={f.href}
                  className="group block px-2 text-center"
                  {...(f.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                  <span className="block font-mono text-3xl font-semibold tracking-tight text-white sm:text-4xl">{f.value}</span>
                  <span className="mt-2 block text-sm text-white/60 transition group-hover:text-white/85">{f.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Problem ────────────────────────────────────── */}
        <section className="px-4 py-24 sm:px-8 md:py-32">
          <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2">
            <div>
              <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-teal-300">Why it exists</p>
              <h2 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl md:text-5xl">
                Note apps keep your words. <Gradient>Chatbots forget them.</Gradient>
              </h2>
              <p className="mt-6 text-pretty text-lg leading-relaxed text-white/65">
                Good ideas end up split between a notes app that can&apos;t think and an AI chat that can&apos;t
                remember. Brain Portal keeps a durable copy of everything you capture, and gives the AI that copy
                to work from.
              </p>
            </div>
            <div className="grid gap-3">
              {[
                { before: "An idea typed into a chat window", after: "Captured, filed and findable next month" },
                { before: "Explaining your project again to a blank AI", after: "Ask about a note and it already has the context" },
                { before: "A to-do buried in a meeting note", after: "Spotted and suggested as a task for you to accept" },
                { before: "An agent's output you can't trace", after: "A draft in your review queue, with its history" },
              ].map((row) => (
                <div key={row.before} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4 text-sm">
                  <span className="text-white/50 line-through decoration-white/25">{row.before}</span>
                  <ArrowRight className="h-4 w-4 text-teal-300" aria-label="becomes" />
                  <span className="text-white/90">{row.after}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Pillars ────────────────────────────────────── */}
        <section id="product" className="scroll-mt-20 px-4 pb-24 sm:px-8 md:pb-32">
          <div className="mx-auto max-w-6xl">
            <SectionHeading
              eyebrow="The product"
              title={<>Capture, find, ask, delegate. <Gradient>All from what you wrote.</Gradient></>}
              body="Six parts of one workspace, built on the same records, so nothing is copied between apps."
            />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {PILLARS.map((p) => {
                const Icon = PILLAR_ICONS[p.id] ?? Sparkles;
                return (
                  <article
                    key={p.id}
                    className="group relative flex flex-col rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-6 transition hover:border-teal-300/30 md:p-7"
                  >
                    <div className="mb-5 flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-400/10 text-teal-300">
                        <Icon className="h-[18px] w-[18px]" aria-hidden />
                      </span>
                      <span className="font-mono text-xs uppercase tracking-[0.18em] text-white/55">{p.eyebrow}</span>
                    </div>
                    <h3 className="text-xl font-semibold tracking-tight text-white">{p.title}</h3>
                    <p className="mt-3 text-[15px] leading-relaxed text-white/65">{p.body}</p>
                    <ul className="mt-5 space-y-2.5 border-t border-white/[0.06] pt-5">
                      {p.points.map((point) => (
                        <li key={point} className="flex gap-2.5 text-sm text-white/75">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-300" aria-hidden />
                          {point}
                        </li>
                      ))}
                    </ul>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Highlight to instruct ──────────────────────── */}
        <section className="border-y border-white/[0.06] bg-white/[0.015] px-4 py-24 sm:px-8 md:py-32">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1fr_1.15fr]">
            <div>
              <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-teal-300">Highlight to instruct</p>
              <h2 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl md:text-5xl">
                The colour <Gradient>is the instruction.</Gradient>
              </h2>
              <p className="mt-6 text-pretty text-lg leading-relaxed text-white/65">
                Highlight a passage and the colour says what you want done with it. Every AI that later reads
                the note gets the same meanings, so a review answers your markup without you writing a prompt.
              </p>
              <p className="mt-4 text-sm text-white/50">Try a colour. Each has a keyboard shortcut in the editor.</p>
            </div>
            <HighlightDemo />
          </div>
        </section>

        {/* ── Your AI ────────────────────────────────────── */}
        <section id="ai" className="scroll-mt-20 px-4 py-24 sm:px-8 md:py-32">
          <div className="mx-auto max-w-6xl">
            <SectionHeading
              eyebrow="Your AI, your rules"
              title={<>You choose the model. <Gradient>You see every call.</Gradient></>}
              body="AI here is something you configure and can audit, not a black box bolted on."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {AI_CONTROL.filter((c) => personalKeys || c.title !== "Bring your own key").map((c) => (
                <div key={c.title} className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
                  <h3 className="font-semibold text-white">{c.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── MCP ────────────────────────────────────────── */}
        <section id="mcp" className="scroll-mt-20 px-4 pb-24 sm:px-8 md:pb-32">
          <div className="mx-auto grid max-w-6xl items-center gap-10 overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-teal-400/[0.07] via-transparent to-transparent p-6 sm:p-10 lg:grid-cols-2 lg:p-14">
            <div>
              <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-teal-300">Works with your AI tools</p>
              <h2 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                Give Claude, Cursor and your own agents <Gradient>a memory.</Gradient>
              </h2>
              <p className="mt-5 text-pretty leading-relaxed text-white/65">
                A built-in Model Context Protocol server with {mcp.tools} tools, {mcp.resources} resources and{" "}
                {mcp.prompts} prompts, over local stdio or HTTPS. Your agents search what you wrote, save what
                you just decided, and read your day before they answer.
              </p>
              <p className="mt-4 text-sm leading-relaxed text-white/55">
                Each key has only the permissions you tick, its own rate limit and an optional expiry. Revoke it
                and it stops at once.
              </p>
            </div>
            <div className="min-w-0 rounded-2xl border border-white/10 bg-[#05050a] p-5 font-mono text-[13px] leading-relaxed">
              <div className="mb-4 flex items-center gap-2 text-white/45">
                <Code2 className="h-4 w-4" aria-hidden /> MCP connector
              </div>
              <p className="break-all text-white/80">
                <span className="text-teal-300">POST</span> https://&lt;this-instance&gt;/api/mcp/rpc
              </p>
              <p className="text-white/50">Authorization: Bearer bp_mcp_&#8230;</p>
              <div className="mt-5 space-y-1.5 border-t border-white/[0.06] pt-4">
                {mcp.examples.map((name) => (
                  <p key={name} className="truncate text-white/70">
                    <span className="text-teal-300/80">tool</span> {name}
                  </p>
                ))}
                <p className="text-white/40">+ {Math.max(mcp.tools - mcp.examples.length, 0)} more</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Feature index ──────────────────────────────── */}
        <section className="border-y border-white/[0.06] bg-white/[0.015] px-4 py-24 sm:px-8 md:py-32">
          <div className="mx-auto max-w-6xl">
            <SectionHeading
              eyebrow="Everything else"
              title="The details you'd want."
              body="All of it shipped and in the app today. Nothing on this list is a roadmap item."
            />
            <div className="grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURE_INDEX.map((group) => (
                <div key={group.title}>
                  <h3 className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-teal-300">{group.title}</h3>
                  <ul className="space-y-4">
                    {group.items.map((item) => (
                      <li key={item.title}>
                        <p className="text-sm font-semibold text-white">{item.title}</p>
                        <p className="mt-1 text-sm leading-relaxed text-white/60">{item.body}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Trust ──────────────────────────────────────── */}
        <section id="trust" className="scroll-mt-20 px-4 py-24 sm:px-8 md:py-32">
          <div className="mx-auto max-w-6xl">
            <SectionHeading
              eyebrow="Trust"
              title={<>Don&apos;t take our word for it. <Gradient>Read the code.</Gradient></>}
              body="Every claim below links to the file that does it. A privacy page can say anything; source code has to run."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {TRUST.map((t) => (
                <div key={t.title} className="flex flex-col rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6">
                  <Lock className="mb-4 h-5 w-5 text-teal-300" aria-hidden />
                  <h3 className="font-semibold text-white">{t.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-white/65">{t.body}</p>
                  <a
                    href={codeLink(sourceUrl, t.evidence[0])}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-5 inline-flex items-center gap-1.5 text-sm text-teal-300 transition hover:text-teal-200"
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                    Read the code
                    <span className="sr-only">for {t.title.toLowerCase()}</span>
                  </a>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-col items-start justify-between gap-6 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 sm:flex-row sm:items-center md:p-8">
              <div className="flex gap-4">
                <Network className="mt-0.5 h-5 w-5 shrink-0 text-teal-300" aria-hidden />
                <div>
                  <h3 className="font-semibold text-white">Or run it yourself</h3>
                  <p className="mt-1 max-w-xl text-sm leading-relaxed text-white/65">
                    Your own database, your own email account, your own AI key. Your notes live on servers you
                    choose, and the AGPL keeps every copy of the code open.
                  </p>
                </div>
              </div>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-white/15 px-5 text-sm font-semibold text-white transition hover:border-teal-300/50 hover:bg-teal-400/10"
              >
                View the source <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
            </div>
          </div>
        </section>

        {/* ── Limits ─────────────────────────────────────── */}
        <section className="px-4 pb-24 sm:px-8 md:pb-32">
          <div className="mx-auto max-w-4xl">
            <SectionHeading
              eyebrow="Straight answers"
              title="What it doesn't do (yet)."
              body="Better you hear it here than find it after you've moved your notes in."
            />
            <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-white/[0.02]">
              {LIMITS.map((l) => (
                <li key={l.title} className="flex gap-4 p-5 md:p-6">
                  <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300/80" aria-hidden />
                  <div>
                    <p className="font-semibold text-white">{l.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-white/65">{l.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Steps ──────────────────────────────────────── */}
        {!signupOpen && (
          <section className="border-y border-white/[0.06] bg-white/[0.015] px-4 py-24 sm:px-8 md:py-28">
            <div className="mx-auto max-w-6xl">
              <SectionHeading eyebrow="How joining works" title="Three steps. No password." />
              <ol className="grid gap-4 md:grid-cols-3">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="rounded-2xl border border-white/[0.08] bg-[#07070c] p-6 md:p-7">
                    <span className="font-mono text-sm text-teal-300">0{i + 1}</span>
                    <h3 className="mt-3 text-lg font-semibold text-white">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-white/65">{s.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        )}

        {/* ── FAQ ────────────────────────────────────────── */}
        <section id="faq" className="scroll-mt-20 px-4 py-24 sm:px-8 md:py-32">
          <div className="mx-auto max-w-3xl">
            <SectionHeading eyebrow="FAQ" title="Questions, answered." />
            <div className="divide-y divide-white/[0.07] border-y border-white/[0.07]">
              {FAQ.map((f) => (
                <details key={f.q} className="group py-1">
                  <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 py-3 text-left font-medium text-white [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <ChevronDown className="h-5 w-5 shrink-0 text-white/50 transition group-open:rotate-180" aria-hidden />
                  </summary>
                  <p className="pb-5 pr-8 text-[15px] leading-relaxed text-white/65">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ──────────────────────────────────── */}
        <section className="relative overflow-hidden px-4 pb-28 pt-8 sm:px-8 md:pb-36">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[30rem] bg-[radial-gradient(ellipse_60%_60%_at_50%_100%,rgba(45,212,191,0.14),transparent)]" />
          <div className="relative mx-auto max-w-2xl text-center">
            <h2 className="text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-5xl md:text-6xl">
              Stop losing <Gradient>good ideas.</Gradient>
            </h2>
            <p className="mx-auto mt-5 max-w-md text-lg text-white/65">
              {signupOpen ? "Make an account with your email and start with one thought." : "Get on the list. We'll email you when your spot is ready."}
            </p>
            <div className="mx-auto mt-10 max-w-lg">
              <JoinForm signupOpen={signupOpen} id="final-join" />
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────── */}
      <footer className="border-t border-white/[0.06] px-4 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 py-10 text-sm text-white/55 md:flex-row">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-teal-600 to-teal-300">
              <Brain className="h-3.5 w-3.5 text-[#04110f]" aria-hidden />
            </span>
            <span className="text-white/80">Brain Portal</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <a href="/auth/login" className="transition hover:text-white">Sign in</a>
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="transition hover:text-white">
              Source code
            </a>
            <a href={`${sourceUrl}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer" className="transition hover:text-white">
              AGPL-3.0 license
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
