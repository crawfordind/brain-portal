import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { queryOne } from "@/lib/db/client";
import { checkRateLimit } from "@/lib/rate-limit";
import DOMPurify from "dompurify";
import { parseHTML } from "linkedom";

const { window: linkedomWindow } = parseHTML("");
const purify = DOMPurify(linkedomWindow as unknown as Window & typeof globalThis);

interface SharedNote {
  id: string;
  title: string | null;
  content: string;
  word_count: number | null;
}

/**
 * Validates if a string is a valid UUID v4
 */
function isValidUUID(token: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(token);
}

async function getSharedNote(token: string): Promise<SharedNote | null> {
  // Validate token format before querying
  if (!isValidUUID(token)) {
    return null;
  }

  try {
    const row = await queryOne<SharedNote>(
      `SELECT id, title, content, word_count
       FROM notes
       WHERE share_token = ? AND share_token IS NOT NULL`,
      [token]
    );

    return row;
  } catch (error) {
    console.error("Error fetching shared note:", error);
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const note = await getSharedNote(token);

  if (!note) {
    return {
      title: "Note Not Found",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const title = note.title || "Untitled Note";
  const excerpt = note.content.slice(0, 160).replace(/[#*_`]/g, "");

  return {
    title: `${title} - Shared Note`,
    description: excerpt,
    robots: {
      index: false,
      follow: false,
    },
  };
}

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "u", "s", "a", "ul", "ol", "li",
  "blockquote", "code", "pre", "h1", "h2", "h3", "h4", "h5", "h6",
  "img", "hr", "table", "thead", "tbody", "tr", "th", "td", "mark",
  "sub", "sup", "span", "div",
];
const ALLOWED_ATTR = ["href", "target", "rel", "title", "alt", "src", "class", "data-intent", "data-note"];

function sanitizeHtml(html: string): string {
  return purify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}

export default async function SharedNotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Rate limiting
  const rateLimit = await checkRateLimit({
    maxRequests: 100,
    windowMs: 60 * 60 * 1000, // 100 requests per hour
  });

  if (!rateLimit.allowed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Too Many Requests</h1>
          <p className="text-gray-600">
            Please try again later.
          </p>
        </div>
      </div>
    );
  }

  const note = await getSharedNote(token);

  if (!note) {
    notFound();
  }

  const title = note.title || "Untitled Note";
  const renderedContent = sanitizeHtml(note.content);

  return (
    <div
      className="min-h-screen bg-gray-50"
      style={{
        "--foreground": "oklch(0.14 0.01 280)",
        "--muted-foreground": "oklch(0.50 0.01 280)",
        "--muted": "oklch(0.96 0 0)",
        "--primary": "oklch(0.45 0.14 160)",
        "--border": "oklch(0.90 0 0)",
      } as React.CSSProperties}
    >
      <div className="max-w-3xl mx-auto px-4 py-12">
        <article className="bg-white rounded-lg shadow-sm p-8">
          <header className="mb-8 pb-6 border-b border-gray-200">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-900 mb-2">
              {title}
            </h1>
            {note.word_count && (
              <p className="text-sm text-gray-500">
                {note.word_count.toLocaleString()} words
              </p>
            )}
          </header>

          <div
            className="prose lg:prose-lg max-w-none leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderedContent }}
          />
        </article>

        <footer className="mt-16 pt-8 border-t border-gray-200">
          <div className="text-center space-y-1">
            <p className="text-sm text-gray-500">
              Shared with <span className="text-gray-700 font-medium">Brain Portal</span>
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
