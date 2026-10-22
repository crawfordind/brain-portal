import { highlightTerms, parseSnippet } from "@/lib/search/snippet";

const MARK_CLASS = "rounded-sm bg-yellow-200/80 px-0.5 text-foreground dark:bg-yellow-500/30";

interface SearchSnippetProps {
  /** A snippet from /api/search (plain text with highlight markers). */
  snippet: string | null | undefined;
  className?: string;
}

/**
 * Renders a search snippet as text with the matched words marked. Built from
 * React text nodes, so nothing in a note can become markup here.
 */
export function SearchSnippet({ snippet, className }: SearchSnippetProps) {
  const segments = parseSnippet(snippet);
  if (segments.length === 0) return null;
  return (
    <span className={className}>
      {segments.map((segment, i) =>
        segment.highlight ? (
          <mark key={i} className={MARK_CLASS}>
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      )}
    </span>
  );
}

interface HighlightedTextProps {
  text: string;
  terms: string[];
  className?: string;
}

/** Plain text (a title) with any of the query's words marked. */
export function HighlightedText({ text, terms, className }: HighlightedTextProps) {
  return <SearchSnippet snippet={highlightTerms(text, terms)} className={className} />;
}
