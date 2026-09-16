/**
 * Local processing utilities (free, no API calls)
 * Runs synchronously and can be used on every note save
 */

export interface Link {
  type: "internal" | "external" | "wikilink";
  target: string;
  text: string;
  position: { start: number; end: number };
}

export interface StructureAnalysis {
  headings: { level: number; text: string; position: number }[];
  lists: { type: "ordered" | "unordered"; items: string[]; position: number }[];
  codeBlocks: { language: string; content: string; position: number }[];
  taskItems: { checked: boolean; text: string; position: number }[];
  wordCount: number;
  paragraphCount: number;
  estimatedReadTime: number; // minutes
  hasImages: boolean;
  hasTables: boolean;
}

/**
 * Extract all links from content (wikilinks, markdown links, bare URLs)
 */
export function extractLinks(content: string): Link[] {
  const links: Link[] = [];

  // Wikilinks: [[Page Name]] or [[Page Name|Display Text]]
  const wikiLinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let match;
  while ((match = wikiLinkRegex.exec(content)) !== null) {
    links.push({
      type: "wikilink",
      target: match[1].trim(),
      text: (match[2] || match[1]).trim(),
      position: { start: match.index, end: match.index + match[0].length },
    });
  }

  // Markdown links: [text](url)
  const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  while ((match = mdLinkRegex.exec(content)) !== null) {
    const url = match[2];
    links.push({
      type: url.startsWith("http") ? "external" : "internal",
      target: url,
      text: match[1],
      position: { start: match.index, end: match.index + match[0].length },
    });
  }

  return links;
}

/**
 * Extract wikilink targets (for creating note connections)
 */
export function extractWikilinks(content: string): string[] {
  const links = extractLinks(content);
  return links
    .filter((l) => l.type === "wikilink")
    .map((l) => l.target);
}

/**
 * Analyze the structure of a note
 */
export function analyzeStructure(content: string): StructureAnalysis {
  const headings: StructureAnalysis["headings"] = [];
  const lists: StructureAnalysis["lists"] = [];
  const codeBlocks: StructureAnalysis["codeBlocks"] = [];
  const taskItems: StructureAnalysis["taskItems"] = [];

  // Extract headings
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push({
      level: match[1].length,
      text: match[2].trim(),
      position: match.index,
    });
  }

  // Extract code blocks
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    codeBlocks.push({
      language: match[1] || "text",
      content: match[2],
      position: match.index,
    });
  }

  // Extract task items
  const taskRegex = /^[\s]*[-*]\s+\[([ xX])\]\s+(.+)$/gm;
  while ((match = taskRegex.exec(content)) !== null) {
    taskItems.push({
      checked: match[1].toLowerCase() === "x",
      text: match[2].trim(),
      position: match.index,
    });
  }

  // Extract lists (simplified - just detect list blocks)
  const listRegex = /^([\s]*)[-*+]\s+.+$/gm;
  const orderedListRegex = /^([\s]*)\d+\.\s+.+$/gm;
  let listItems: string[] = [];
  let listStart = -1;
  let lastEnd = -1;

  const processLists = (regex: RegExp, type: "ordered" | "unordered") => {
    let m;
    while ((m = regex.exec(content)) !== null) {
      if (listStart === -1 || m.index > lastEnd + 2) {
        if (listItems.length > 0) {
          lists.push({ type, items: listItems, position: listStart });
        }
        listItems = [];
        listStart = m.index;
      }
      listItems.push(m[0].replace(/^[\s]*[-*+\d.]+\s+/, ""));
      lastEnd = m.index + m[0].length;
    }
    if (listItems.length > 0) {
      lists.push({ type, items: listItems, position: listStart });
    }
    listItems = [];
    listStart = -1;
  };

  processLists(listRegex, "unordered");
  processLists(orderedListRegex, "ordered");

  // Calculate word count
  const plainText = stripMarkdown(content);
  const words = plainText.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;

  // Calculate paragraphs
  const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const paragraphCount = paragraphs.length;

  // Estimate read time (200 words per minute average)
  const estimatedReadTime = Math.max(1, Math.ceil(wordCount / 200));

  // Check for images
  const hasImages = /!\[[^\]]*\]\([^)]+\)/.test(content) || /<img\s/.test(content);

  // Check for tables
  const hasTables = /\|.+\|/.test(content) && /\|[-:]+\|/.test(content);

  return {
    headings,
    lists,
    codeBlocks,
    taskItems,
    wordCount,
    paragraphCount,
    estimatedReadTime,
    hasImages,
    hasTables,
  };
}

/**
 * Strip markdown formatting to get plain text
 */
export function stripMarkdown(content: string): string {
  return content
    // Remove code blocks first
    .replace(/```[\s\S]*?```/g, " ")
    // Remove inline code
    .replace(/`[^`]+`/g, " ")
    // Remove images
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    // Remove links but keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove wikilinks but keep text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, "$2$1")
    // Remove headers
    .replace(/^#+\s+/gm, "")
    // Remove emphasis
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    // Remove strikethrough
    .replace(/~~([^~]+)~~/g, "$1")
    // Remove horizontal rules
    .replace(/^[-*_]{3,}$/gm, "")
    // Remove blockquotes
    .replace(/^>\s+/gm, "")
    // Remove list markers
    .replace(/^[\s]*[-*+]\s+/gm, "")
    .replace(/^[\s]*\d+\.\s+/gm, "")
    // Remove task markers
    .replace(/\[[ xX]\]\s+/g, "")
    // Remove HTML tags
    .replace(/<[^>]+>/g, " ")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Count words in content
 */
export function countWords(content: string): number {
  const plainText = stripMarkdown(content);
  const words = plainText.split(/\s+/).filter((w) => w.length > 0);
  return words.length;
}

/**
 * Extract a summary from the first paragraph or heading
 */
export function extractExcerpt(content: string, maxLength: number = 200): string {
  // Remove leading headings
  const text = content.replace(/^#+\s+.+\n+/, "");

  // Get first paragraph
  const paragraphs = text.split(/\n\s*\n/);
  const firstParagraph = paragraphs.find((p) => {
    const trimmed = p.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#") && !trimmed.startsWith("```");
  });

  if (!firstParagraph) {
    return "";
  }

  const plain = stripMarkdown(firstParagraph);

  if (plain.length <= maxLength) {
    return plain;
  }

  // Truncate at word boundary
  const truncated = plain.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated) + "...";
}

/**
 * Detect potential tags from content
 * (hashtags, frequently mentioned terms, etc.)
 */
export function detectPotentialTags(content: string): string[] {
  const tags = new Set<string>();

  // Extract hashtags
  const hashtagRegex = /#([a-zA-Z][a-zA-Z0-9_-]*)/g;
  let match;
  while ((match = hashtagRegex.exec(content)) !== null) {
    tags.add(match[1].toLowerCase());
  }

  // Extract frontmatter tags if present
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const tagsMatch = frontmatterMatch[1].match(/tags:\s*\[([^\]]+)\]/);
    if (tagsMatch) {
      const fmTags = tagsMatch[1].split(",").map((t) => t.trim().replace(/["']/g, ""));
      fmTags.forEach((t) => tags.add(t.toLowerCase()));
    }
  }

  return Array.from(tags);
}

/**
 * Process a note locally (free operations only)
 */
export interface LocalProcessingResult {
  links: Link[];
  wikilinks: string[];
  structure: StructureAnalysis;
  excerpt: string;
  potentialTags: string[];
  contentPlain: string;
}

export function processLocally(content: string): LocalProcessingResult {
  return {
    links: extractLinks(content),
    wikilinks: extractWikilinks(content),
    structure: analyzeStructure(content),
    excerpt: extractExcerpt(content),
    potentialTags: detectPotentialTags(content),
    contentPlain: stripMarkdown(content),
  };
}
