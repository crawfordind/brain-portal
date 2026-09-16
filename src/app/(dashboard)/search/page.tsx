"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { sanitizeHtml } from "@/lib/sanitize";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search as SearchIcon,
  FileText,
  Lightbulb,
  CheckSquare,
  Paperclip,
} from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";

interface SearchResult {
  id: string;
  type: "note" | "capture" | "task" | "attachment";
  title: string;
  content: string;
  snippet: string;
  slug?: string;
  project_name?: string;
  note_title?: string;
  file_type?: string;
  file_size?: number;
  storage_url?: string;
  created_at: string;
  updated_at: string;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  note: <FileText className="h-4 w-4 text-blue-500" />,
  capture: <Lightbulb className="h-4 w-4 text-yellow-500" />,
  task: <CheckSquare className="h-4 w-4 text-green-500" />,
  attachment: <Paperclip className="h-4 w-4 text-purple-500" />,
};

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileTypeIcon = (fileType: string | undefined) => {
  if (!fileType) return '📎';
  if (fileType.startsWith('image/')) return '🖼️';
  if (fileType === 'application/pdf') return '📑';
  if (fileType.startsWith('application/') || fileType.startsWith('text/')) return '📄';
  if (fileType.startsWith('audio/')) return '🎵';
  if (fileType.startsWith('video/')) return '🎬';
  return '📎';
};

function SearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [fileTypeFilter, setFileTypeFilter] = useState<string>("all");

  // Sync query with URL params after mount to avoid hydration mismatch
  useEffect(() => {
    const urlQuery = searchParams.get("q") || "";
    if (urlQuery) {
      setQuery(urlQuery);
      setDebouncedQuery(urlQuery);
    }
     
  }, [searchParams]); // Only sync when searchParams changes, not query

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      if (query) {
        router.replace(`/search?q=${encodeURIComponent(query)}`);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, router]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["search", debouncedQuery, typeFilter, fileTypeFilter],
    queryFn: async () => {
      if (!debouncedQuery.trim()) return { results: [], total: 0 };
      let url = `/api/search?q=${encodeURIComponent(debouncedQuery)}`;
      if (typeFilter !== "all") url += `&type=${typeFilter}`;
      if (typeFilter === "attachment" && fileTypeFilter !== "all") {
        url += `&fileType=${fileTypeFilter}`;
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error("Search failed");
      return response.json();
    },
    enabled: debouncedQuery.length > 0,
  });

  const results = data?.results as SearchResult[] || [];
  const total = data?.total || 0;

  // Group results by type
  const noteResults = results.filter((r) => r.type === "note");
  const captureResults = results.filter((r) => r.type === "capture");
  const taskResults = results.filter((r) => r.type === "task");
  const attachmentResults = results.filter((r) => r.type === "attachment");

  const getResultLink = (result: SearchResult) => {
    switch (result.type) {
      case "note":
        return `/notes/${result.slug}`;
      case "capture":
        return `/captures`;
      case "task":
        return `/tasks`;
      default:
        return "#";
    }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Search Header */}
      <div>
        {/* RESPONSIVE: Smaller title on mobile */}
        <h1 className="text-xl font-bold mb-3 md:text-2xl md:mb-4">Search</h1>
        {/* MOBILE: Stack search and filter on small screens */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            {/* TOUCH: Larger input height on mobile */}
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes, captures, and tasks..."
              className="pl-10 h-11 md:h-9"
              autoFocus
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full sm:w-32 min-h-11 md:min-h-9">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="note">Notes</SelectItem>
              <SelectItem value="capture">Captures</SelectItem>
              <SelectItem value="task">Tasks</SelectItem>
              <SelectItem value="attachment">Attachments</SelectItem>
            </SelectContent>
          </Select>
          {typeFilter === "attachment" && (
            <Select value={fileTypeFilter} onValueChange={setFileTypeFilter}>
              <SelectTrigger className="w-full sm:w-40 min-h-11 md:min-h-9">
                <SelectValue placeholder="File type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All files</SelectItem>
                <SelectItem value="image">🖼️ Images</SelectItem>
                <SelectItem value="pdf">📑 PDFs</SelectItem>
                <SelectItem value="document">📄 Documents</SelectItem>
                <SelectItem value="audio">🎵 Audio</SelectItem>
                <SelectItem value="video">🎬 Video</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Results */}
      {!debouncedQuery ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <SearchIcon className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Search your brain</h2>
          <p className="text-muted-foreground">
            Find notes, captures, tasks, and attachments by keyword
          </p>
        </div>
      ) : isLoading || isFetching ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <SearchIcon className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">No results found</h2>
          <p className="text-muted-foreground">
            Try different keywords or check your spelling
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs md:text-sm text-muted-foreground">
            Found {total} result{total !== 1 ? "s" : ""} for &ldquo;{debouncedQuery}&rdquo;
          </p>

          <div className="space-y-6">
            {/* Note Results */}
            {noteResults.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <FileText className="size-5" />
                  Notes ({noteResults.length})
                </h2>
                <div className="space-y-3 md:space-y-4">
                  {noteResults.map((result) => (
                    <Link
                      key={result.id}
                      href={getResultLink(result)}
                      className="block p-3 md:p-4 border rounded-lg hover:bg-muted/50 transition-colors min-h-[80px]"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-1 shrink-0">
                          {TYPE_ICONS[result.type]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 md:gap-2 mb-1">
                            <h3 className="font-medium truncate text-sm md:text-base">
                              {result.title}
                            </h3>
                            {result.project_name && (
                              <Badge variant="secondary" className="text-xs shrink-0">
                                {result.project_name}
                              </Badge>
                            )}
                          </div>
                          <p
                            className="text-xs md:text-sm text-muted-foreground line-clamp-2"
                            dangerouslySetInnerHTML={{
                              __html: sanitizeHtml(result.snippet).replace(
                                /<mark>/g,
                                '<mark class="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">'
                              ),
                            }}
                          />
                          <p className="text-xs text-muted-foreground mt-2">
                            {format(new Date(result.updated_at), "MMM d, yyyy")}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Attachment Results */}
            {attachmentResults.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Paperclip className="size-5" />
                  Attachments ({attachmentResults.length})
                </h2>
                <div className="space-y-2">
                  {attachmentResults.map((attachment) => (
                    <Card key={attachment.id} className="p-4 hover:bg-accent/50 transition-colors">
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-12 rounded bg-muted flex items-center justify-center text-2xl flex-shrink-0">
                          {getFileTypeIcon(attachment.file_type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium truncate">{attachment.title}</h3>
                          <p
                            className="text-sm text-muted-foreground mt-1 line-clamp-2"
                            dangerouslySetInnerHTML={{
                              __html: sanitizeHtml(attachment.snippet).replace(
                                /<mark>/g,
                                '<mark class="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">'
                              ),
                            }}
                          />
                          {(attachment.project_name || attachment.note_title) && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Attached to: {attachment.project_name && <span>{attachment.project_name}</span>}
                              {attachment.project_name && attachment.note_title && <span> &gt; </span>}
                              {attachment.note_title && <span>{attachment.note_title}</span>}
                            </p>
                          )}
                          <div className="flex gap-3 mt-2">
                            <Button variant="outline" size="sm" asChild>
                              <a href={attachment.storage_url} target="_blank" rel="noopener noreferrer">
                                Preview
                              </a>
                            </Button>
                            <Button variant="outline" size="sm" asChild>
                              <a href={attachment.storage_url} download>
                                Download
                              </a>
                            </Button>
                          </div>
                        </div>
                        {attachment.file_size && (
                          <div className="text-sm text-muted-foreground">
                            {formatFileSize(attachment.file_size)}
                          </div>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {/* Capture Results */}
            {captureResults.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Lightbulb className="size-5" />
                  Captures ({captureResults.length})
                </h2>
                <div className="space-y-3 md:space-y-4">
                  {captureResults.map((result) => (
                    <Link
                      key={result.id}
                      href={getResultLink(result)}
                      className="block p-3 md:p-4 border rounded-lg hover:bg-muted/50 transition-colors min-h-[80px]"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-1 shrink-0">
                          {TYPE_ICONS[result.type]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 md:gap-2 mb-1">
                            <h3 className="font-medium truncate text-sm md:text-base">
                              {result.content.substring(0, 50)}
                            </h3>
                            {result.project_name && (
                              <Badge variant="secondary" className="text-xs shrink-0">
                                {result.project_name}
                              </Badge>
                            )}
                          </div>
                          <p
                            className="text-xs md:text-sm text-muted-foreground line-clamp-2"
                            dangerouslySetInnerHTML={{
                              __html: sanitizeHtml(result.snippet).replace(
                                /<mark>/g,
                                '<mark class="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">'
                              ),
                            }}
                          />
                          <p className="text-xs text-muted-foreground mt-2">
                            {format(new Date(result.updated_at), "MMM d, yyyy")}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Task Results */}
            {taskResults.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <CheckSquare className="size-5" />
                  Tasks ({taskResults.length})
                </h2>
                <div className="space-y-3 md:space-y-4">
                  {taskResults.map((result) => (
                    <Link
                      key={result.id}
                      href={getResultLink(result)}
                      className="block p-3 md:p-4 border rounded-lg hover:bg-muted/50 transition-colors min-h-[80px]"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-1 shrink-0">
                          {TYPE_ICONS[result.type]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 md:gap-2 mb-1">
                            <h3 className="font-medium truncate text-sm md:text-base">
                              {result.content.substring(0, 50)}
                            </h3>
                            {result.project_name && (
                              <Badge variant="secondary" className="text-xs shrink-0">
                                {result.project_name}
                              </Badge>
                            )}
                          </div>
                          <p
                            className="text-xs md:text-sm text-muted-foreground line-clamp-2"
                            dangerouslySetInnerHTML={{
                              __html: sanitizeHtml(result.snippet).replace(
                                /<mark>/g,
                                '<mark class="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">'
                              ),
                            }}
                          />
                          <p className="text-xs text-muted-foreground mt-2">
                            {format(new Date(result.updated_at), "MMM d, yyyy")}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-32 mb-4" />
          <div className="flex items-center gap-4">
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
        <div className="flex flex-col items-center justify-center py-12">
          <Skeleton className="h-12 w-12 rounded-full mb-4" />
          <Skeleton className="h-6 w-40 mb-2" />
          <Skeleton className="h-4 w-60" />
        </div>
      </div>
    }>
      <SearchContent />
    </Suspense>
  );
}
