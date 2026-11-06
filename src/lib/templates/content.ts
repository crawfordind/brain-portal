/**
 * Template bodies: reading structure out of notes, and writing sections back
 * as editor HTML. Pure and regex-based, so it runs server-side with no DOM
 * (same approach as `lenses/blocks.ts`).
 *
 * The model never writes HTML here. It proposes sections as data
 * (`TemplateSection`), and `sectionsToHtml` renders them with every string
 * escaped, so a draft cannot smuggle markup into a note.
 */

import type { SectionKind, TemplateSection } from "./types";
import { MAX_SECTION_ITEMS, MAX_SECTIONS } from "./types";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;"
  );
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** A heading's identity: case, punctuation and a trailing colon don't matter. */
export function headingKey(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[:：]\s*$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function cleanHeading(raw: string): string {
  return raw.replace(/[:：]\s*$/, "").replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * Headings in a note, in order: HTML `<h1>`–`<h6>`, markdown `#` lines, and a
 * paragraph that is nothing but a short bold label ("**Attendees:**"), which
 * is how many people head a section in a meeting note.
 */
export function extractHeadings(content: string): string[] {
  if (!content) return [];
  const found: Array<{ at: number; text: string }> = [];

  for (const m of content.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
    found.push({ at: m.index ?? 0, text: stripTags(m[1]) });
  }
  for (const m of content.matchAll(/<p[^>]*>\s*<(strong|b)>([\s\S]*?)<\/\1>\s*:?\s*<\/p>/gi)) {
    const text = stripTags(m[2]);
    if (text.length <= 60) found.push({ at: m.index ?? 0, text });
  }
  for (const m of content.matchAll(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    found.push({ at: m.index ?? 0, text: m[1].replace(/[*_`]/g, "") });
  }
  for (const m of content.matchAll(/^\s*\*\*([^*\n]{1,60})\*\*\s*:?\s*$/gm)) {
    found.push({ at: m.index ?? 0, text: m[1] });
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const { text } of found.sort((a, b) => a.at - b.at)) {
    const heading = cleanHeading(text);
    const key = headingKey(heading);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(heading);
  }
  return out;
}

const KINDS: readonly SectionKind[] = ["text", "list", "checklist"];

/** Coerce anything section-shaped into a valid section, or null. */
export function normalizeSection(raw: unknown): TemplateSection | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const heading = typeof r.heading === "string" ? cleanHeading(r.heading) : "";
  if (!heading) return null;
  const hint = typeof r.hint === "string" ? r.hint.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  const kind = KINDS.includes(r.kind as SectionKind) ? (r.kind as SectionKind) : "text";
  const items = Array.isArray(r.items)
    ? r.items
        .filter((i): i is string => typeof i === "string")
        .map((i) => i.replace(/\s+/g, " ").trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, MAX_SECTION_ITEMS)
    : [];
  return { heading, hint, kind, items };
}

export function normalizeSections(raw: unknown): TemplateSection[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: TemplateSection[] = [];
  for (const entry of raw) {
    const section = normalizeSection(entry);
    if (!section) continue;
    const key = headingKey(section.heading);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(section);
    if (out.length >= MAX_SECTIONS) break;
  }
  return out;
}

/** Render sections as editor HTML (TipTap's shapes, task lists included). */
export function sectionsToHtml(sections: TemplateSection[]): string {
  const parts: string[] = [];
  for (const s of sections) {
    parts.push(`<h2>${escapeHtml(s.heading)}</h2>`);
    if (s.hint) parts.push(`<p><em>${escapeHtml(s.hint)}</em></p>`);
    if (s.kind === "checklist") {
      const items = s.items.length ? s.items : [""];
      parts.push(
        `<ul data-type="taskList">${items
          .map((i) => `<li data-type="taskItem" data-checked="false"><p>${escapeHtml(i)}</p></li>`)
          .join("")}</ul>`
      );
    } else if (s.kind === "list") {
      const items = s.items.length ? s.items : [""];
      parts.push(`<ul>${items.map((i) => `<li><p>${escapeHtml(i)}</p></li>`).join("")}</ul>`);
    } else if (!s.hint) {
      parts.push("<p></p>");
    }
  }
  return parts.join("");
}

/**
 * A note's structure without its words: its headings as empty sections.
 * "Save as template → structure only" uses it, so last week's figures are not
 * copied into every future meeting.
 */
export function structureOnly(content: string): string {
  const headings = extractHeadings(content);
  if (!headings.length) return "";
  return sectionsToHtml(headings.map((heading) => ({ heading, hint: "", kind: "text", items: [] })));
}

/** Plain text of a note for a prompt, keeping its shape (headings, lists), capped. */
export function plainForPrompt(content: string, max = 2500): string {
  if (!content) return "";
  let text = content;
  if (/<[a-z][\s\S]*>/i.test(content)) {
    text = decodeEntities(
      content
        .replace(/<h([1-6])[^>]*>/gi, (_m, n) => `\n${"#".repeat(Number(n))} `)
        .replace(/<li[^>]*data-checked="(true|false)"[^>]*>/gi, (_m, c) => (c === "true" ? "\n- [x] " : "\n- [ ] "))
        .replace(/<li[^>]*>/gi, "\n- ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|h[1-6]|div|blockquote|ul|ol|tr)>/gi, "\n")
        .replace(/<[^>]*>/g, "")
    );
  }
  const shaped = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n\n(?=- )/g, "\n")
    .trim();
  return shaped.length > max ? `${shaped.slice(0, max)}…` : shaped;
}
