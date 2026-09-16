import { marked } from "marked";

// Configure marked for consistent output
marked.setOptions({
  gfm: true,
  breaks: true,
});

// Check if content looks like Markdown (not HTML)
export function isMarkdown(content: string): boolean {
  if (!content) return false;

  // If it starts with HTML tags, it's likely HTML
  if (content.trim().startsWith("<") && !content.trim().startsWith("< ")) {
    return false;
  }

  // Common markdown patterns
  const markdownPatterns = [
    /^#{1,6}\s/m,           // Headers
    /^\s*[-*+]\s/m,         // Unordered lists
    /^\s*\d+\.\s/m,         // Ordered lists
    /\[.+\]\(.+\)/,         // Links
    /!\[.+\]\(.+\)/,        // Images
    /`[^`]+`/,              // Inline code
    /```[\s\S]*```/,        // Code blocks
    /^\s*>/m,               // Blockquotes
    /\*\*.+\*\*/,           // Bold
    /\*.+\*/,               // Italic
    /~~.+~~/,               // Strikethrough
    /^\s*\|.+\|.*\n\s*\|[-:| ]+\|/m, // Tables (header + separator row)
  ];

  return markdownPatterns.some(pattern => pattern.test(content));
}

// Convert markdown to HTML
export function markdownToHtml(content: string): string {
  if (!content) return "";

  // Parse markdown to HTML
  const html = marked.parse(content, { async: false }) as string;
  return html;
}

// Smart convert: only converts if content looks like markdown
export function smartConvertToHtml(content: string): string {
  if (!content) return "";

  // If it's already HTML, return as-is
  if (!isMarkdown(content)) {
    return content;
  }

  return markdownToHtml(content);
}
