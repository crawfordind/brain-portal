'use client';

import { useMemo } from 'react';
import { marked } from 'marked';
import { cn } from '@/lib/utils';
import { sanitizeHtml } from '@/lib/sanitize';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const html = useMemo(() => {
    try {
      // Strip XML wrapper tags if present (e.g., <previous_output version="2">)
      let cleanContent = content;
      const xmlTagMatch = cleanContent.match(/<previous_output[^>]*>([\s\S]*?)<\/previous_output>/);
      if (xmlTagMatch) {
        cleanContent = xmlTagMatch[1].trim();
      }

      // Configure marked for safe rendering
      marked.setOptions({
        breaks: true,
        gfm: true,
      });

      // Override link renderer to add target="_blank"
      const renderer = {
        link(token: { href: string; title?: string | null; text: string }) {
          const titleAttr = token.title ? ` title="${token.title}"` : '';
          return `<a href="${token.href}"${titleAttr} target="_blank" rel="noopener noreferrer">${token.text}</a>`;
        }
      };

      marked.use({ renderer });

      // Parse synchronously (default behavior) and ensure it's a string
      const result = marked.parse(cleanContent);
      return typeof result === 'string' ? sanitizeHtml(result) : cleanContent;
    } catch (error) {
      console.error('Markdown parsing error:', error);
      // Sanitize even the fallback. Returning raw `content` here put
      // unsanitized input straight into dangerouslySetInnerHTML, so any input
      // that could make `marked` throw was an XSS primitive.
      return sanitizeHtml(content);
    }
  }, [content]);

  return (
    <div
      className={cn(
        'prose prose-slate dark:prose-invert max-w-none',
        'prose-headings:font-semibold prose-headings:tracking-tight',
        'prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:text-sm',
        'prose-pre:bg-muted prose-pre:border prose-pre:border-border',
        'prose-a:text-primary prose-a:no-underline hover:prose-a:underline',
        'prose-blockquote:border-l-primary prose-blockquote:border-l-4 prose-blockquote:pl-4 prose-blockquote:italic',
        'prose-img:rounded-lg prose-img:shadow-md',
        className
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
