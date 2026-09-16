"use client";

import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";

/* ─── tiny helpers ─────────────────────────────────────────── */
function cn(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}

/* ─── useInView hook (IntersectionObserver) ────────────────── */
function useInView(options?: { threshold?: number; rootMargin?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.unobserve(el);
        }
      },
      { threshold: options?.threshold ?? 0.15, rootMargin: options?.rootMargin ?? "0px 0px -60px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [options?.threshold, options?.rootMargin]);

  return { ref, isInView };
}

/* ─── AnimatedSection wrapper ──────────────────────────────── */
type AnimationType = "fadeUp" | "fadeIn" | "scaleIn";

const ANIMATION_INITIAL: Record<AnimationType, { opacity: number; transform: string }> = {
  fadeUp: { opacity: 0, transform: "translateY(40px)" },
  fadeIn: { opacity: 0, transform: "none" },
  scaleIn: { opacity: 0, transform: "scale(0.97)" },
};

const ANIMATION_FINAL: Record<AnimationType, { opacity: number; transform: string }> = {
  fadeUp: { opacity: 1, transform: "translateY(0)" },
  fadeIn: { opacity: 1, transform: "none" },
  scaleIn: { opacity: 1, transform: "scale(1)" },
};

function AnimatedSection({
  children,
  animation = "fadeUp",
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  animation?: AnimationType;
  delay?: number;
  className?: string;
}) {
  const { ref, isInView } = useInView();
  const state = isInView ? ANIMATION_FINAL[animation] : ANIMATION_INITIAL[animation];

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: state.opacity,
        transform: state.transform,
        transition: `opacity 0.9s cubic-bezier(0.16, 1, 0.3, 1) ${delay}s, transform 0.9s cubic-bezier(0.16, 1, 0.3, 1) ${delay}s`,
        willChange: "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}

/* ─── data ──────────────────────────────────────────────────── */
const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Compare", href: "#compare" },
  { label: "How it works", href: "#how" },
  { label: "Privacy", href: "#privacy" },
];

const STEPS = [
  {
    n: "01",
    title: "Request early access",
    body: "Enter your email. We\u2019ll let you know when your spot is ready.",
  },
  {
    n: "02",
    title: "Get your invite",
    body: "A magic link, no password. One click and you\u2019re in.",
  },
  {
    n: "03",
    title: "Start thinking out loud",
    body: "Write, speak, or delegate. Your ideas start connecting immediately.",
  },
];

/* ─── Waitlist form ─────────────────────────────────────────── */
function WaitlistForm({ compact = false }: { compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(async (e: React.FormEvent) => {
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
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Something went wrong.");
        setState("error");
      } else {
        setState("done");
      }
    } catch {
      setErrorMsg("Network error \u2014 please try again.");
      setState("error");
    }
  }, [email, state]);

  if (state === "done") {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5",
          compact ? "py-3 text-sm" : "py-4"
        )}
      >
        <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs shrink-0">
          {"\u2713"}
        </div>
        <div>
          <div className="text-emerald-300 font-semibold text-sm">You&apos;re on the list</div>
          <div className="text-emerald-400/70 text-xs mt-0.5">
            We&apos;ll reach out to {email} when your spot is ready.
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={cn("flex gap-2", compact ? "flex-row" : "flex-col sm:flex-row")}>
      <input
        ref={inputRef}
        type="email"
        required
        value={email}
        onChange={(e) => { setEmail(e.target.value); setState("idle"); }}
        placeholder="your@email.com"
        className={cn(
          "flex-1 min-w-0 rounded-xl border border-white/10 bg-white/[0.06] px-4 text-white placeholder:text-white/25 outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all",
          compact ? "h-10 text-sm" : "h-12 text-sm"
        )}
      />
      <button
        type="submit"
        disabled={state === "loading"}
        className={cn(
          "shrink-0 rounded-xl bg-teal-600 px-6 font-semibold text-white transition-all hover:bg-teal-500 active:scale-[0.98] disabled:opacity-60",
          compact ? "h-10 text-sm" : "h-12 text-sm"
        )}
      >
        {state === "loading" ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Joining{"\u2026"}
          </span>
        ) : "Request early access"}
      </button>
      {state === "error" && (
        <p className="w-full text-red-400 text-xs mt-1">{errorMsg}</p>
      )}
    </form>
  );
}

/* ─── Typography-driven feature block ─────────────────────── */
function FeatureBlock({
  id,
  bg,
  eyebrow,
  headline,
  body,
  detail,
}: {
  id?: string;
  bg: string;
  eyebrow: string;
  headline: ReactNode;
  body: string;
  detail?: string;
}) {
  return (
    <section id={id} style={{ background: bg }} className="relative">
      <div className="max-w-5xl mx-auto px-6 py-24 md:px-10 md:py-40 min-h-[70vh] flex flex-col justify-center">
        <AnimatedSection animation="fadeUp">
          <p className="text-teal-400 text-xs font-mono uppercase tracking-[0.2em] mb-6">
            {eyebrow}
          </p>
        </AnimatedSection>
        <AnimatedSection animation="fadeUp" delay={0.08}>
          <h2 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-[-0.04em] leading-[1.05] mb-8 max-w-4xl">
            {headline}
          </h2>
        </AnimatedSection>
        <AnimatedSection animation="fadeUp" delay={0.16}>
          <p className="text-white/40 text-lg md:text-xl leading-relaxed max-w-2xl mb-4">
            {body}
          </p>
          {detail && (
            <p className="text-white/20 text-sm md:text-base leading-relaxed max-w-xl">
              {detail}
            </p>
          )}
        </AnimatedSection>
      </div>
    </section>
  );
}

/* ─── Page ──────────────────────────────────────────────────── */
export default function WaitlistPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen text-white" style={{ background: "#05050a", fontFamily: "var(--font-geist-sans, system-ui, sans-serif)" }}>

      {/* ── Noise texture overlay ─────────────────────────────── */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.025]"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E\")", backgroundSize: "256px" }}
      />

      {/* ── Nav ──────────────────────────────────────────────── */}
      <nav
        className={cn(
          "fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 md:px-10 h-14 transition-all duration-300",
          scrolled ? "bg-[#05050a]/90 backdrop-blur-md border-b border-white/[0.06]" : "bg-transparent"
        )}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-teal-600 to-teal-400" />
          <span className="font-semibold text-sm tracking-tight">Brain</span>
        </div>
        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((l) => (
            <a key={l.label} href={l.href} className="text-white/40 hover:text-white/80 text-sm transition-colors">
              {l.label}
            </a>
          ))}
        </div>
        <a
          href="#hero-form"
          className="text-sm font-semibold px-4 py-1.5 rounded-full border border-white/10 hover:border-teal-500/50 hover:bg-teal-600/10 transition-all text-white/70 hover:text-white"
        >
          Get early access
        </a>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-16 text-center overflow-hidden">
        {/* gradient orbs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute -top-48 left-1/2 -translate-x-1/2 w-[1200px] h-[800px] opacity-25"
            style={{ background: "radial-gradient(ellipse, #4f46e5 0%, transparent 70%)" }}
          />
          <div
            className="absolute top-64 -left-64 w-[700px] h-[700px] opacity-12"
            style={{ background: "radial-gradient(circle, #7c3aed 0%, transparent 70%)" }}
          />
          <div
            className="absolute top-80 -right-48 w-[600px] h-[600px] opacity-8"
            style={{ background: "radial-gradient(circle, #2563eb 0%, transparent 70%)" }}
          />
        </div>

        {/* badge */}
        <AnimatedSection animation="fadeIn" className="relative mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/30 bg-teal-600/10 px-4 py-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
            <span className="text-teal-300 text-xs font-medium tracking-wide">Early access {"\u00B7"} Limited spots</span>
          </div>
        </AnimatedSection>

        {/* headline */}
        <AnimatedSection animation="fadeUp" delay={0.1} className="relative">
          <h1 className="max-w-5xl text-5xl sm:text-7xl md:text-8xl lg:text-[112px] font-bold tracking-[-0.05em] leading-[0.95] mb-8">
            <span className="text-white">Think.</span>
            <br />
            <span className="text-white">Delegate.</span>
            <br />
            <span
              className="inline-block"
              style={{ background: "linear-gradient(135deg, #2dd4bf, #5eead4, #99f6e4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
            >
              Done.
            </span>
          </h1>
        </AnimatedSection>

        <AnimatedSection animation="fadeUp" delay={0.2} className="relative">
          <p className="max-w-lg text-base md:text-lg lg:text-xl text-white/40 leading-relaxed mb-12">
            A workspace where your ideas become tasks, your tasks become agent work,
            and everything stays connected. No busywork.
          </p>
        </AnimatedSection>

        {/* form */}
        <AnimatedSection animation="fadeUp" delay={0.3} className="relative w-full max-w-md">
          <div id="hero-form">
            <WaitlistForm />
            <p className="mt-3 text-white/20 text-xs">No password needed. Magic link when your spot opens.</p>
          </div>
        </AnimatedSection>
      </section>

      {/* ── Signal strip ─────────────────────────────────────── */}
      <section style={{ background: "#07070f" }} className="border-y border-white/[0.04]">
        <div className="max-w-6xl mx-auto px-6 py-16 md:py-24 md:px-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
            {[
              { number: "17", label: "AI agents at your disposal" },
              { number: "1", label: "Input for everything" },
              { number: "0", label: "Passwords to remember" },
              { number: "100%", label: "Your data, your control" },
            ].map((stat, i) => (
              <AnimatedSection key={stat.label} animation="fadeUp" delay={i * 0.1} className="text-center">
                <div className="text-4xl sm:text-5xl md:text-6xl font-bold font-mono text-white tracking-tight mb-2">
                  {stat.number}
                </div>
                <div className="text-[11px] sm:text-xs text-white/25 uppercase tracking-widest">
                  {stat.label}
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features anchor ─────────────────────────────────── */}
      <div id="features" />

      {/* ── Feature: The Stream ──────────────────────────────── */}
      <FeatureBlock
        bg="#05050a"
        eyebrow="One input"
        headline={
          <>
            <span className="text-white">Type a thought.</span>{" "}
            <span style={{ background: "linear-gradient(135deg, #2dd4bf, #0d9488)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              We figure out the rest.
            </span>
          </>
        }
        body="The Brain Bar classifies everything you throw at it — notes, tasks, questions, URLs, voice memos — and routes it to the right place. One input. No menus, no decisions. Cmd+K to search anything, Cmd+Shift+C to capture instantly."
        detail="Think of it as a command line for your brain."
      />

      {/* ── Feature: Agents ─────────────────────────────────── */}
      <FeatureBlock
        bg="#07070f"
        eyebrow="AI agents"
        headline={
          <>
            <span className="text-white">Delegate the work</span>{" "}
            <span style={{ background: "linear-gradient(135deg, #5eead4, #99f6e4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              you shouldn&apos;t be doing.
            </span>
          </>
        }
        body="17 specialized agents across code, writing, research, marketing, analysis, UX, legal, finance, HR, product, sales, ops, security, data engineering, education, and strategy. Assign any content — notes, tasks, captures — and auto-routing picks the right expert."
        detail="Every agent sees your notes, your projects, your context. Review, revise up to 5 times, or approve. No copy-pasting into ChatGPT."
      />

      {/* ── Feature: Connections ─────────────────────────────── */}
      <FeatureBlock
        id="connections"
        bg="#05050a"
        eyebrow="Connections"
        headline={
          <>
            <span className="text-white">Your notes</span>{" "}
            <span style={{ background: "linear-gradient(135deg, #2dd4bf, #5eead4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              already know each other.
            </span>
          </>
        }
        body="Every note is embedded into vector space. Related ideas surface automatically — no tags, no folders, no manual linking. You write, the connections appear. Explore them in a live knowledge graph."
        detail="Semantic similarity, not keyword matching. Five connection types — related, references, extends, contradicts, supports — with wikilinks and hub/bridge/orphan detection."
      />

      {/* ── Feature: Capture ────────────────────────────────── */}
      <FeatureBlock
        bg="#07070f"
        eyebrow="Capture"
        headline={
          <>
            <span className="text-white">Voice, text, link.</span>{" "}
            <span style={{ background: "linear-gradient(135deg, #fb7185, #f97316)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Nothing gets lost.
            </span>
          </>
        }
        body="Speak a thought on your phone. Paste a URL at your desk. Drop in images, PDFs, or files. Everything gets transcribed, classified, auto-tagged, and connected to what's relevant — before you finish your coffee."
      />

      {/* ── Feature: Editor ─────────────────────────────────── */}
      <FeatureBlock
        bg="#05050a"
        eyebrow="Editor"
        headline={
          <>
            <span className="text-white">Write.</span>{" "}
            <span style={{ background: "linear-gradient(135deg, #2dd4bf, #0d9488)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Don&apos;t manage.
            </span>
          </>
        }
        body="Markdown editor with centered cursor. Distraction-free. Related notes appear alongside your writing — not because you tagged them, but because they&apos;re actually related. Wikilinks, frontmatter, and images just work."
      />

      {/* ── Feature: Work ───────────────────────────────────── */}
      <FeatureBlock
        bg="#07070f"
        eyebrow="Tasks"
        headline={
          <>
            <span className="text-white">From thought</span>{" "}
            <span style={{ background: "linear-gradient(135deg, #5eead4, #99f6e4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              to shipped.
            </span>
          </>
        }
        body="Tasks are born from notes, AI-recommended from your captures, scheduled in calendar or kanban views, and delegated to agents. Recurring tasks, priorities, due dates, and project hierarchy — all linked back to the thinking that inspired them."
      />

      {/* ── More features grid ──────────────────────────────── */}
      <section style={{ background: "#05050a" }} className="border-y border-white/[0.04]">
        <div className="max-w-5xl mx-auto px-6 py-16 md:py-24 md:px-10">
          <AnimatedSection animation="fadeUp" className="text-center mb-14">
            <h3 className="text-2xl sm:text-3xl font-bold tracking-tight">Everything else you&apos;d expect.</h3>
            <p className="text-white/25 text-sm mt-3 max-w-md mx-auto">And a lot you wouldn&apos;t.</p>
          </AnimatedSection>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {[
              { title: "Daily Notes", body: "Templated journals with mood, energy, and focus tracking" },
              { title: "Weekly Reviews", body: "AI-generated summaries of your progress and patterns" },
              { title: "Journal Entries", body: "Flexible journaling across 10 categories with monthly compilations" },
              { title: "Voice Input", body: "Speech-to-text capture with voice commands and shortcuts" },
              { title: "Full-Text Search", body: "FTS5-indexed search across all notes, captures, and tasks" },
              { title: "Semantic Search", body: "Vector similarity finds meaning, not just keywords" },
              { title: "Smart Tags", body: "AI-suggested tags, applied automatically to every capture" },
              { title: "Quick Capture", body: "Cmd+Shift+C for fleeting thoughts, ideas, links, and quotes" },
              { title: "Knowledge Graph", body: "Visual graph of note connections with hub and bridge detection" },
              { title: "Project Management", body: "Hierarchies, health scoring, collaboration, and dashboards" },
              { title: "Task Calendar", body: "Day, week, and month views with kanban and backlog sidebar" },
              { title: "AI Chat", body: "Multi-turn conversations with agents scoped to your context" },
              { title: "Skills System", body: "8 automated skills — digest, triage, insights, notifications, and more" },
              { title: "Heartbeat Scheduler", body: "Automated checks and actions that run while you sleep" },
              { title: "File Attachments", body: "Images, PDFs, docs, and audio with auto-extraction and thumbnails" },
              { title: "Notifications", body: "In-app and email alerts for due dates, digests, and agent outputs" },
              { title: "Obsidian Import", body: "One-click vault migration with folder-to-project mapping" },
              { title: "Markdown Export", body: "Export your vault as .md files or a ZIP archive anytime" },
              { title: "AI Guardrails", body: "Set your values, style, and boundaries — agents adapt to you" },
              { title: "Collaboration", body: "Invite editors and viewers to projects with role-based access" },
              { title: "Task Recommendations", body: "AI scans your notes and suggests tasks you haven't created yet" },
              { title: "Wikilinks", body: "[[Double-bracket]] cross-references with automatic backlinking" },
              { title: "Mobile Ready", body: "Full PWA with 56px touch targets and full-screen command palette" },
              { title: "Passwordless Auth", body: "Magic links — no passwords to leak, no credentials to manage" },
            ].map((item, i) => (
              <AnimatedSection key={item.title} animation="fadeUp" delay={i * 0.04}>
                <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-4 md:p-5 h-full">
                  <div className="text-white/80 font-semibold text-sm mb-1">{item.title}</div>
                  <div className="text-white/25 text-xs leading-relaxed">{item.body}</div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── Competitive comparison grid ──────────────────────── */}
      <section id="compare" style={{ background: "#07070f" }} className="border-b border-white/[0.04]">
        <div className="max-w-6xl mx-auto px-6 py-16 md:py-24 md:px-10">
          <AnimatedSection animation="fadeUp" className="text-center mb-14">
            <p className="text-teal-400 text-xs font-mono uppercase tracking-[0.2em] mb-4">Comparison</p>
            <h3 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-[-0.03em] mb-4">
              How we{" "}
              <span style={{ background: "linear-gradient(135deg, #2dd4bf, #5eead4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                stack up.
              </span>
            </h3>
            <p className="text-white/25 text-sm max-w-lg mx-auto leading-relaxed">
              Most tools make you choose between AI power and knowledge management depth. We built both.
            </p>
          </AnimatedSection>

          <AnimatedSection animation="fadeUp" delay={0.1}>
            <div className="overflow-x-auto -mx-6 px-6 md:mx-0 md:px-0">
              <table className="w-full text-sm border-collapse min-w-[700px]">
                <thead>
                  <tr className="border-b border-white/[0.08]">
                    <th className="text-left text-white/40 font-medium py-4 pr-4 pl-2 w-[200px]">Feature</th>
                    <th className="text-center px-3 py-4">
                      <div className="inline-flex items-center gap-1.5">
                        <div className="w-4 h-4 rounded bg-gradient-to-br from-teal-600 to-teal-400 shrink-0" />
                        <span className="text-white font-semibold text-sm">Brain</span>
                      </div>
                    </th>
                    <th className="text-center text-white/40 font-medium px-3 py-4">Notion</th>
                    <th className="text-center text-white/40 font-medium px-3 py-4">Obsidian</th>
                    <th className="text-center text-white/40 font-medium px-3 py-4">Roam</th>
                    <th className="text-center text-white/40 font-medium px-3 py-4">Mem</th>
                    <th className="text-center text-white/40 font-medium px-3 py-4">Apple Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { feature: "AI Agent Delegation", dc: true, notion: "partial", obsidian: false, roam: false, mem: "partial", apple: false },
                    { feature: "17 Specialist Agents", dc: true, notion: false, obsidian: false, roam: false, mem: false, apple: false },
                    { feature: "Auto-Route to Best Agent", dc: true, notion: false, obsidian: false, roam: false, mem: false, apple: false },
                    { feature: "Semantic Search (Vectors)", dc: true, notion: true, obsidian: "partial", roam: false, mem: true, apple: false },
                    { feature: "Knowledge Graph", dc: true, notion: false, obsidian: true, roam: true, mem: false, apple: false },
                    { feature: "AI Insights & Patterns", dc: true, notion: "partial", obsidian: false, roam: false, mem: "partial", apple: false },
                    { feature: "AI Task Recommendations", dc: true, notion: false, obsidian: false, roam: false, mem: false, apple: false },
                    { feature: "Voice Capture & Commands", dc: true, notion: false, obsidian: false, roam: false, mem: true, apple: true },
                    { feature: "Daily Notes & Journaling", dc: true, notion: "partial", obsidian: true, roam: true, mem: false, apple: false },
                    { feature: "Weekly AI Reviews", dc: true, notion: false, obsidian: false, roam: false, mem: false, apple: false },
                    { feature: "Task Management", dc: true, notion: true, obsidian: "partial", roam: true, mem: false, apple: false },
                    { feature: "Calendar & Kanban Views", dc: true, notion: true, obsidian: "partial", roam: false, mem: false, apple: false },
                    { feature: "Project Hierarchies", dc: true, notion: true, obsidian: true, roam: false, mem: false, apple: "partial" },
                    { feature: "Markdown Editor", dc: true, notion: "partial", obsidian: true, roam: "partial", mem: true, apple: false },
                    { feature: "Wikilinks & Backlinks", dc: true, notion: "partial", obsidian: true, roam: true, mem: true, apple: false },
                    { feature: "Automated Workflows", dc: true, notion: "partial", obsidian: false, roam: false, mem: false, apple: false },
                    { feature: "Skills & Heartbeat System", dc: true, notion: false, obsidian: false, roam: false, mem: false, apple: false },
                    { feature: "File Attachments", dc: true, notion: true, obsidian: true, roam: true, mem: true, apple: true },
                    { feature: "Collaboration", dc: true, notion: true, obsidian: false, roam: true, mem: false, apple: true },
                    { feature: "Export to Markdown", dc: true, notion: "partial", obsidian: true, roam: true, mem: true, apple: false },
                    { feature: "Passwordless Auth", dc: true, notion: false, obsidian: false, roam: false, mem: false, apple: "partial" },
                    { feature: "AI Guardrails / Personalization", dc: true, notion: false, obsidian: false, roam: false, mem: "partial", apple: false },
                    { feature: "No AI Training on Data", dc: true, notion: false, obsidian: true, roam: true, mem: false, apple: true },
                    { feature: "Obsidian Vault Import", dc: true, notion: false, obsidian: true, roam: false, mem: false, apple: false },
                  ].map((row, i) => (
                    <tr key={row.feature} className={cn("border-b border-white/[0.04]", i % 2 === 0 ? "bg-white/[0.01]" : "")}>
                      <td className="py-3 pr-4 pl-2 text-white/60 font-medium">{row.feature}</td>
                      {[row.dc, row.notion, row.obsidian, row.roam, row.mem, row.apple].map((val, j) => (
                        <td key={j} className="text-center px-3 py-3">
                          {val === true ? (
                            <span className={cn("inline-block w-5 h-5 rounded-full text-xs leading-5 font-bold", j === 0 ? "bg-teal-500/20 text-teal-400" : "bg-white/[0.06] text-white/40")}>
                              {"\u2713"}
                            </span>
                          ) : val === "partial" ? (
                            <span className="inline-block w-5 h-5 rounded-full bg-white/[0.04] text-white/20 text-xs leading-5">{"\u00BD"}</span>
                          ) : (
                            <span className="inline-block w-5 h-5 rounded-full bg-white/[0.02] text-white/10 text-xs leading-5">{"\u2014"}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-center gap-6 mt-6 text-[11px] text-white/20">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded-full bg-teal-500/20 text-teal-400 text-[9px] leading-[14px] text-center font-bold">{"\u2713"}</span>
                Full support
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded-full bg-white/[0.04] text-white/20 text-[9px] leading-[14px] text-center">{"\u00BD"}</span>
                Partial / plugin
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded-full bg-white/[0.02] text-white/10 text-[9px] leading-[14px] text-center">{"\u2014"}</span>
                Not available
              </span>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Privacy ──────────────────────────────────────────── */}
      <section id="privacy" style={{ background: "#030308" }} className="relative">
        <div className="max-w-5xl mx-auto px-6 py-20 md:px-10 md:py-32 min-h-[70vh] flex flex-col items-center justify-center">
          <AnimatedSection animation="fadeUp" className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-[-0.04em] leading-[1.05] mb-6">
              Your knowledge<br />
              <span style={{ background: "linear-gradient(135deg, #2dd4bf, #5eead4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                stays yours.
              </span>
            </h2>
            <p className="text-white/30 text-base md:text-lg max-w-md mx-auto leading-relaxed">
              Privacy isn&apos;t a feature. It&apos;s the architecture.
            </p>
          </AnimatedSection>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 md:gap-8 max-w-3xl w-full">
            {[
              { title: "Passwordless auth", body: "Magic links. No passwords to leak, no credentials to manage." },
              { title: "Secure sessions", body: "HTTP-only cookies. Can\u2019t be accessed by scripts." },
              { title: "Isolated data", body: "Your notes are stored separately from every other user." },
              { title: "No training", body: "Your notes never train any AI model. Ever." },
            ].map((item, i) => (
              <AnimatedSection key={item.title} animation="fadeUp" delay={i * 0.1}>
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6 md:p-8">
                  <div className="text-white font-semibold text-base mb-2">{item.title}</div>
                  <div className="text-white/30 text-sm leading-relaxed">{item.body}</div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section id="how" style={{ background: "#05050a" }}>
        <div className="max-w-5xl mx-auto px-6 py-20 md:px-10 md:py-32">
          <AnimatedSection animation="fadeUp" className="text-center mb-16 md:mb-20">
            <h2 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-[-0.04em] mb-4">Three steps.</h2>
            <p className="text-white/30 text-base md:text-lg">No onboarding flows. No setup wizards.</p>
          </AnimatedSection>

          <div className="grid md:grid-cols-3 gap-12 md:gap-8">
            {STEPS.map((step, i) => (
              <AnimatedSection key={step.n} animation="fadeUp" delay={i * 0.15}>
                <div className="relative text-left">
                  <div className="text-7xl md:text-8xl font-bold text-white/[0.04] tracking-tight mb-4 font-mono leading-none">{step.n}</div>
                  <h3 className="text-white font-semibold text-lg mb-3">{step.title}</h3>
                  <p className="text-white/30 text-sm leading-relaxed">{step.body}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────── */}
      <section className="relative min-h-[70vh] flex flex-col items-center justify-center px-6 py-20 text-center overflow-hidden" style={{ background: "#05050a" }}>
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse 80% 60% at 50% 80%, #4f46e530 0%, transparent 70%)" }}
        />

        <AnimatedSection animation="fadeUp">
          <h2 className="relative text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-[-0.04em] mb-6 leading-[1.05]">
            Stop organizing.<br />
            <span style={{ background: "linear-gradient(135deg, #2dd4bf, #5eead4, #99f6e4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Start thinking.
            </span>
          </h2>
        </AnimatedSection>

        <AnimatedSection animation="fadeUp" delay={0.1}>
          <p className="relative text-white/35 text-base md:text-lg mb-12 max-w-md mx-auto leading-relaxed">
            Magic link. No password. No friction.
          </p>
        </AnimatedSection>

        <AnimatedSection animation="fadeUp" delay={0.2} className="relative w-full max-w-sm">
          <WaitlistForm compact />
        </AnimatedSection>
      </section>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.05] px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-md bg-gradient-to-br from-teal-600 to-teal-400" />
          <span className="text-white/40 text-sm">Brain</span>
        </div>
        <p className="text-white/20 text-xs text-center">
          Think. Delegate. Done.
        </p>
        <p className="text-white/20 text-xs">&copy; {new Date().getFullYear()} Brain Portal</p>
      </footer>
    </div>
  );
}
