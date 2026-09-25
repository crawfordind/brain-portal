/**
 * Note body → a flat list of blocks (headings, paragraphs, list items, tables).
 *
 * Notes arrive in two dialects: the editor saves TipTap HTML, while MCP tools,
 * imports and `/api/brain` often write markdown. Both reduce to the same block
 * list so sensing never has to care which one it was handed.
 *
 * Regex-based rather than DOM-based, like `annotations/extract.ts`: this runs
 * in route handlers, where there is no `document`, as well as in the browser.
 */

export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "para"; text: string; section: number }
  | {
      type: "item";
      text: string;
      depth: number;
      ordered: boolean;
      /** Present only on checkbox items. */
      checked?: boolean;
      /** Index among checkbox items, in document order. */
      taskIndex?: number;
      section: number;
    }
  | { type: "table"; headers: string[]; rows: string[][]; section: number };

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

const clean = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim();

export function looksLikeHtml(content: string): boolean {
  return /<(p|h[1-6]|ul|ol|li|table|div|br|blockquote)\b[^>]*>/i.test(content);
}

export function toBlocks(content: string): Block[] {
  if (!content || !content.trim()) return [];
  return looksLikeHtml(content) ? htmlToBlocks(content) : markdownToBlocks(content);
}

// ─── HTML ────────────────────────────────────────────────────────────────────

/** Tags whose open or close ends the current run of text. */
const BOUNDARY = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ul", "ol", "br", "div",
  "blockquote", "pre", "table", "thead", "tbody", "tr", "td", "th", "hr",
]);
const VOID = new Set(["br", "hr", "img", "input"]);

interface Open {
  tag: string;
  attrs: string;
}

function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  const stack: Open[] = [];
  let text = "";
  let section = 0;
  let taskCount = 0;

  // Table state: rows of cells, whether a <th> was seen, and the open cell.
  let table: { rows: string[][]; headerRow: boolean } | null = null;
  let row: string[] | null = null;
  let cell: string | null = null;

  const innermost = (...tags: string[]) => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (tags.includes(stack[i].tag)) return stack[i];
    }
    return null;
  };

  // The <li> currently collecting text, and whether it was already emitted,
  // so a task item's box state is attached once even if its text spans <p>s.
  const liTaskIndex = new Map<Open, number>();

  const flush = () => {
    const t = clean(text);
    text = "";
    if (cell !== null) {
      cell = cell ? `${cell} ${t}`.trim() : t;
      return;
    }
    if (!t) return;
    const heading = innermost("h1", "h2", "h3", "h4", "h5", "h6");
    if (heading) {
      section++;
      blocks.push({ type: "heading", level: Number(heading.tag[1]), text: t });
      return;
    }
    const li = innermost("li");
    if (li) {
      const depth = stack.filter((o) => o.tag === "li").length;
      const list = innermost("ul", "ol");
      const checkedMatch = li.attrs.match(/data-checked\s*=\s*["']?(true|false)/i);
      const item: Block = {
        type: "item",
        text: t,
        depth,
        ordered: list?.tag === "ol",
        section,
      };
      if (checkedMatch) {
        if (!liTaskIndex.has(li)) liTaskIndex.set(li, taskCount++);
        item.checked = checkedMatch[1].toLowerCase() === "true";
        item.taskIndex = liTaskIndex.get(li);
      }
      blocks.push(item);
      return;
    }
    blocks.push({ type: "para", text: t, section });
  };

  const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(html))) {
    if (m[4] !== undefined) {
      text += m[4];
      continue;
    }
    if (!m[2]) continue; // comment
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const attrs = m[3] ?? "";

    if (BOUNDARY.has(tag)) flush();

    if (tag === "table") {
      if (!closing) {
        table = { rows: [], headerRow: false };
      } else if (table) {
        const [first, ...rest] = table.rows;
        if (first) {
          const width = Math.max(...table.rows.map((r) => r.length));
          const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
          blocks.push(
            table.headerRow
              ? { type: "table", headers: pad(first), rows: rest.map(pad), section }
              : {
                  type: "table",
                  headers: Array.from({ length: width }, (_, i) => `Column ${i + 1}`),
                  rows: table.rows.map(pad),
                  section,
                }
          );
        }
        table = null;
      }
      continue;
    }
    if (table) {
      if (tag === "tr") {
        if (!closing) row = [];
        else if (row) {
          if (row.some((c) => c)) table.rows.push(row);
          row = null;
        }
        continue;
      }
      if (tag === "td" || tag === "th") {
        if (!closing) {
          cell = "";
          if (tag === "th" && table.rows.length === 0) table.headerRow = true;
        } else {
          row?.push(cell ?? "");
          cell = null;
        }
        continue;
      }
    }

    if (VOID.has(tag) || attrs.trim().endsWith("/")) continue;
    if (!closing) {
      stack.push({ tag, attrs });
    } else {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
    }
  }
  flush();
  return blocks;
}

// ─── Markdown ────────────────────────────────────────────────────────────────

function stripInline(s: string): string {
  return clean(
    s
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a)
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[^*\w])[*_]([^*_]+)[*_](?=[^*\w]|$)/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/==([^=]+)==/g, "$1")
  );
}

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => stripInline(c));

function markdownToBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let section = 0;
  let taskCount = 0;
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !raw.trim()) continue;

    const heading = raw.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      section++;
      blocks.push({ type: "heading", level: heading[1].length, text: stripInline(heading[2]) });
      continue;
    }

    // Pipe table: a header row followed by a |---|---| separator.
    if (raw.includes("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const headers = splitRow(raw);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        const r = splitRow(lines[i]);
        rows.push([...r, ...Array(Math.max(0, headers.length - r.length)).fill("")].slice(0, headers.length));
        i++;
      }
      i--;
      blocks.push({ type: "table", headers, rows, section });
      continue;
    }

    const item = raw.match(/^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/);
    if (item) {
      const [, indent, marker, box, body] = item;
      const text = stripInline(body);
      if (!text) continue;
      const b: Block = {
        type: "item",
        text,
        depth: Math.floor(indent.replace(/\t/g, "  ").length / 2) + 1,
        ordered: /\d/.test(marker),
        section,
      };
      if (box !== undefined) {
        b.checked = box.toLowerCase() === "x";
        b.taskIndex = taskCount++;
      }
      blocks.push(b);
      continue;
    }

    const text = stripInline(raw.replace(/^\s*>\s?/, ""));
    if (text) blocks.push({ type: "para", text, section });
  }
  return blocks;
}

// ─── Writing back ────────────────────────────────────────────────────────────

/**
 * Tick or untick the Nth checkbox item in a note body, in either dialect.
 * Returns the body unchanged when there is no such item, so a lens rendered
 * from a slightly stale body can never corrupt the note.
 */
export function setTaskChecked(content: string, taskIndex: number, checked: boolean): string {
  let n = -1;
  if (looksLikeHtml(content)) {
    return content.replace(
      /(<li\b[^>]*\bdata-checked\s*=\s*["']?)(true|false)(["']?)/gi,
      (match, pre: string, _v: string, post: string) =>
        ++n === taskIndex ? `${pre}${checked ? "true" : "false"}${post}` : match
    );
  }
  return content.replace(
    /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/gm,
    (match, pre: string, _v: string, post: string) =>
      ++n === taskIndex ? `${pre}${checked ? "x" : " "}${post}` : match
  );
}
