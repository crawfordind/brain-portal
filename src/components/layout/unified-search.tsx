"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Search, Command, Loader2, X, Plus, Calendar, Flag, FolderOpen, Repeat } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useCommandPalette } from "@/lib/hooks/use-command-palette";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMobile } from "@/hooks/use-mobile";
import { useNLTaskParser } from "@/lib/hooks/use-nl-task-parser";
import { toast } from "sonner";
import { addToQueue } from "@/lib/offline/simple-queue";

interface SearchResult {
  id: string;
  type: "note" | "task" | "capture";
  title: string;
  content: string;
  slug?: string;
}

interface UnifiedSearchProps {
  variant?: "desktop" | "mobile";
}

export function UnifiedSearch({ variant = "desktop" }: UnifiedSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useMobile();
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isMobileOverlayOpen, setIsMobileOverlayOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const queryClient = useQueryClient();
  const { commands, searchCommands, getQuickActions } = useCommandPalette();

  // Fetch projects for NL task parser
  const { data: projectsData } = useQuery({
    queryKey: ['projects-for-nl-parser'],
    queryFn: async () => {
      const res = await fetch('/api/projects');
      if (!res.ok) return [];
      const data = await res.json();
      return (data.projects || []) as Array<{ id: string; name: string }>;
    },
  });

  const parsedTask = useNLTaskParser(query, projectsData);

  // Fix hydration issues
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Hide on search page to avoid duplication
  const isOnSearchPage = pathname === "/search";

  // Search for notes/tasks/captures
  const { data: searchResults, isLoading } = useQuery({
    queryKey: ["quick-search", query],
    queryFn: async () => {
      if (!query.trim() || query.length < 2) return [];

      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=5`);
      if (!response.ok) return [];

      const data = await response.json();
      return (data.results || []) as SearchResult[];
    },
    enabled: query.length >= 2,
  });

  // Filter commands by query
  const filteredCommands = query.length >= 1
    ? searchCommands(query).slice(0, 5)
    : getQuickActions().map(cmd => ({
          id: cmd.id,
          label: cmd.label,
          description: cmd.description,
          icon: cmd.icon,
          shortcut: cmd.shortcut,
          handler: () => cmd.handler(),
        }));


  // Quick create task handler
  const handleQuickCreate = useCallback(async () => {
    if (!parsedTask || !parsedTask.title) return;

    const taskData = {
      content: parsedTask.title,
      priority: parsedTask.priority,
      dueDate: parsedTask.dueDate,
      projectId: parsedTask.projectId,
      recurrenceRule: parsedTask.recurrenceRule,
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskData),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error('Failed to create task');

      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success(`Task created: ${parsedTask.title}`);
    } catch {
      // Offline or server error - queue for later sync
      addToQueue({
        type: 'task',
        operation: 'create',
        data: taskData,
      });
      toast.success(`Task created (queued): ${parsedTask.title}`);
    }

    setIsOpen(false);
    setIsMobileOverlayOpen(false);
    setQuery("");
  }, [parsedTask, queryClient]);

  const showQuickCreate = parsedTask && parsedTask.confidence >= 0.5 && parsedTask.title.length > 0;

  // All results combined (quick create takes index 0 when shown)
  const quickCreateOffset = showQuickCreate ? 1 : 0;
  const allResults = [
    ...(showQuickCreate ? [{ type: 'quick-create' as const, item: parsedTask!, index: 0 }] : []),
    ...filteredCommands.map((cmd, i) => ({ type: 'command' as const, item: cmd, index: quickCreateOffset + i })),
    ...(searchResults || []).map((result, i) => ({ type: 'result' as const, item: result, index: quickCreateOffset + filteredCommands.length + i })),
  ];

  const totalResults = allResults.length;

  // Define handleSelect before it's used in useEffect
  const handleSelect = useCallback((item: typeof allResults[0]) => {
    if (item.type === 'quick-create') {
      handleQuickCreate();
      return;
    }

    setIsOpen(false);
    setQuery("");

    if (item.type === 'command') {
      item.item.handler?.();
    } else if (item.type === 'result') {
      // Navigate to result
      switch (item.item.type) {
        case 'note':
          if (item.item.slug) {
            router.push(`/notes/${item.item.slug}`);
          }
          break;
        case 'task':
          router.push('/tasks');
          break;
        case 'capture':
          router.push('/');
          break;
      }
    }
  }, [router, handleQuickCreate]);

  // Handle keyboard navigation (desktop only)
  useEffect(() => {
    if (variant === "mobile") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % Math.max(1, totalResults));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + totalResults) % Math.max(1, totalResults));
          break;
        case 'Enter':
          e.preventDefault();
          if (totalResults > 0 && allResults[selectedIndex]) {
            handleSelect(allResults[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          setQuery("");
          inputRef.current?.blur();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [variant, isOpen, selectedIndex, totalResults, allResults, handleSelect]);

  // Register global shortcuts for creation commands
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      // Cmd+Shift+C for Quick Capture
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'c') {
        e.preventDefault();
        const captureCmd = commands.find(cmd => cmd.id === 'quick-capture');
        captureCmd?.handler();
      }

      // Cmd+Shift+D for Daily Note / Journal
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'd') {
        e.preventDefault();
        const dailyCmd = commands.find(cmd => cmd.id === 'daily-note');
        dailyCmd?.handler();
      }

      // Cmd+Shift+J for Journal Entry
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'j') {
        e.preventDefault();
        const journalCmd = commands.find(cmd => cmd.id === 'journal-entry');
        journalCmd?.handler();
      }
    };

    document.addEventListener('keydown', handleGlobalShortcuts);
    return () => document.removeEventListener('keydown', handleGlobalShortcuts);
  }, [commands]);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputFocus = () => {
    setIsOpen(true);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setIsOpen(true);
  };

  const handleMobileKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showQuickCreate) {
        handleQuickCreate();
        setIsMobileOverlayOpen(false);
      } else if (totalResults > 0 && allResults[0]) {
        handleSelect(allResults[0]);
        setIsMobileOverlayOpen(false);
      } else if (query.trim()) {
        router.push(`/search?q=${encodeURIComponent(query)}`);
        setIsMobileOverlayOpen(false);
        setQuery("");
      }
    }
  };

  if (isOnSearchPage) {
    return null;
  }

  // Mobile: Show search icon that opens overlay
  if (variant === "mobile") {
    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsMobileOverlayOpen(true)}
          aria-label="Open search"
          className="min-h-[44px] min-w-[44px]"
        >
          <Search className="h-6 w-6" />
        </Button>

        {/* Mobile Overlay */}
        {isMounted && isMobileOverlayOpen && (
          <div className="fixed inset-0 bg-background z-[9999]">
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="flex items-center gap-2 p-4 border-b">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    ref={inputRef}
                    type="text"
                    placeholder="Search or create..."
                    value={query}
                    onChange={handleInputChange}
                    onKeyDown={handleMobileKeyDown}
                    onFocus={() => setIsOpen(true)}
                    className="pl-10 pr-4"
                    autoFocus
                    aria-label="Search notes, tasks, and commands"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close search"
                  onClick={() => {
                    setIsMobileOverlayOpen(false);
                    setQuery("");
                    setIsOpen(false);
                  }}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* Results */}
              <div className="flex-1 overflow-y-auto min-h-[400px] bg-background">
                <div className="py-2 bg-background">
                  {/* Quick Create Section (Mobile) */}
                  {showQuickCreate && (
                    <div className="bg-background">
                      <div className="px-4 py-2 text-xs font-medium text-muted-foreground bg-background">
                        Quick Create
                      </div>
                      <button
                        onClick={() => {
                          handleQuickCreate();
                          setIsMobileOverlayOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-4 min-h-[56px] bg-background hover:bg-accent active:bg-accent"
                      >
                        <Plus className="h-5 w-5 text-primary shrink-0" />
                        <div className="flex-1 text-left min-w-0">
                          <div className="font-medium truncate">{parsedTask!.title}</div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {parsedTask!.parsedFields.includes('dueDate') && parsedTask!.dueDate && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
                                <Calendar className="h-2.5 w-2.5" />
                                {parsedTask!.dueDate}
                              </Badge>
                            )}
                            {parsedTask!.parsedFields.includes('priority') && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
                                <Flag className="h-2.5 w-2.5" />
                                {parsedTask!.priority}
                              </Badge>
                            )}
                            {parsedTask!.parsedFields.includes('projectId') && parsedTask!.projectName && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
                                <FolderOpen className="h-2.5 w-2.5" />
                                {parsedTask!.projectName}
                              </Badge>
                            )}
                            {parsedTask!.parsedFields.includes('recurrenceRule') && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
                                <Repeat className="h-2.5 w-2.5" />
                                recurring
                              </Badge>
                            )}
                          </div>
                        </div>
                      </button>
                    </div>
                  )}

                  {/* Commands Section */}
                  {filteredCommands.length > 0 && (
                    <div className="bg-background">
                      <div className="px-4 py-2 text-xs font-medium text-muted-foreground bg-background">
                        {query.length >= 1 ? "Commands" : "Quick Actions"}
                      </div>
                      {filteredCommands.map((cmd) => {
                        const IconComponent = cmd.icon as React.ComponentType<{ className?: string }>;

                        return (
                          <button
                            key={cmd.id}
                            onClick={() => {
                              cmd.handler?.();
                              setIsMobileOverlayOpen(false);
                              setQuery("");
                            }}
                            className="w-full flex items-center gap-3 px-4 py-4 min-h-[56px] bg-background hover:bg-accent active:bg-accent"
                          >
                            <IconComponent className="h-5 w-5 text-muted-foreground shrink-0" />
                            <div className="flex-1 text-left">
                              <div className="font-medium">{cmd.label}</div>
                              <div className="text-xs text-muted-foreground">
                                {cmd.description}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                    {/* Search Results Section */}
                    {searchResults && searchResults.length > 0 && (
                      <div className={cn("bg-background", filteredCommands.length > 0 && "border-t mt-2 pt-2")}>
                        <div className="px-4 py-2 text-xs font-medium text-muted-foreground bg-background">
                          Results
                        </div>
                        {searchResults.map((result) => (
                          <button
                            key={result.id}
                            onClick={() => {
                              handleSelect({ type: 'result', item: result, index: 0 });
                              setIsMobileOverlayOpen(false);
                            }}
                            className="w-full flex items-start gap-3 px-4 py-4 min-h-[56px] bg-background hover:bg-accent active:bg-accent"
                          >
                            <div className="flex-1 text-left min-w-0">
                              <div className="font-medium truncate">{result.title}</div>
                              <div className="text-xs text-muted-foreground line-clamp-2">
                                {result.content}
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground capitalize shrink-0">
                              {result.type}
                            </div>
                          </button>
                        ))}

                        {/* See all results link */}
                        <button
                          onClick={() => {
                            router.push(`/search?q=${encodeURIComponent(query)}`);
                            setIsMobileOverlayOpen(false);
                            setQuery("");
                          }}
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm text-muted-foreground bg-background hover:bg-accent border-t mt-2"
                        >
                          <Search className="h-4 w-4" />
                          See all results
                        </button>
                      </div>
                    )}

                  {/* Loading state */}
                  {isLoading && query.length >= 2 && (
                    <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground bg-background">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Searching...
                    </div>
                  )}

                  {/* Empty state - only show when truly no results */}
                  {filteredCommands.length === 0 && (!searchResults || searchResults.length === 0) && !isLoading && (
                    <div className="p-8 text-sm text-muted-foreground text-center bg-background">
                      {query.length >= 2
                        ? "No results found"
                        : "Type to search or run commands"}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Desktop: Show search bar with dropdown
  return (
    <div className="relative flex-1 max-w-2xl">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Command className="absolute right-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground opacity-50" />
        <Input
          ref={inputRef}
          type="text"
          placeholder="Search or run a command..."
          value={query}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          className="pl-10 pr-10 w-full h-11"
          aria-label="Search notes, tasks, and commands"
          aria-expanded={isOpen}
          aria-controls="unified-search-results"
          aria-autocomplete="list"
          role="combobox"
        />
      </div>

      {/* Results Dropdown */}
      {isOpen && (
        <div
          ref={dropdownRef}
          id="unified-search-results"
          role="listbox"
          aria-label="Search results"
          className="absolute top-full left-0 right-0 mt-2 bg-popover border rounded-lg shadow-lg z-50 max-h-[400px] overflow-y-auto"
        >
          {totalResults === 0 && !isLoading ? (
            <div className="p-4 text-sm text-muted-foreground text-center">
              {query.length >= 2
                ? "No results found"
                : "Type to search or run commands"}
            </div>
          ) : (
            <div className="py-2">
              {/* Quick Create Section */}
              {showQuickCreate && (
                <div>
                  <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    Quick Create
                  </div>
                  <button
                    onClick={handleQuickCreate}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent cursor-pointer transition-colors",
                      selectedIndex === 0 && "bg-accent"
                    )}
                  >
                    <Plus className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 text-left min-w-0">
                      <div className="font-medium truncate">{parsedTask!.title}</div>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {parsedTask!.parsedFields.includes('dueDate') && parsedTask!.dueDate && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
                            <Calendar className="h-2.5 w-2.5" />
                            {parsedTask!.dueDate}
                          </Badge>
                        )}
                        {parsedTask!.parsedFields.includes('priority') && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
                            <Flag className="h-2.5 w-2.5" />
                            {parsedTask!.priority}
                          </Badge>
                        )}
                        {parsedTask!.parsedFields.includes('projectId') && parsedTask!.projectName && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
                            <FolderOpen className="h-2.5 w-2.5" />
                            {parsedTask!.projectName}
                          </Badge>
                        )}
                        {parsedTask!.parsedFields.includes('recurrenceRule') && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
                            <Repeat className="h-2.5 w-2.5" />
                            recurring
                          </Badge>
                        )}
                      </div>
                    </div>
                    <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                      Enter
                    </kbd>
                  </button>
                </div>
              )}

              {/* Commands Section */}
              {filteredCommands.length > 0 && (
                <div className={cn(showQuickCreate && "border-t mt-2 pt-2")}>
                  <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    {query.length >= 1 ? "Commands" : "Quick Actions"}
                  </div>
                  {filteredCommands.map((cmd, i) => {
                    const IconComponent = cmd.icon as React.ComponentType<{ className?: string }>;
                    const isSelected = selectedIndex === (quickCreateOffset + i);

                    return (
                      <button
                        key={cmd.id}
                        onClick={() => handleSelect({ type: 'command', item: cmd, index: i })}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent cursor-pointer transition-colors",
                          isSelected && "bg-accent"
                        )}
                      >
                        <IconComponent className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 text-left">
                          <div className="font-medium">{cmd.label}</div>
                          <div className="text-xs text-muted-foreground">{cmd.description}</div>
                        </div>
                        {'shortcut' in cmd && cmd.shortcut && (
                          <div className="text-xs text-muted-foreground">{cmd.shortcut}</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Search Results Section */}
              {searchResults && searchResults.length > 0 && (
                <div className={cn((filteredCommands.length > 0 || showQuickCreate) && "border-t mt-2 pt-2")}>
                  <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    Results
                  </div>
                  {searchResults.map((result, i) => {
                    const index = quickCreateOffset + filteredCommands.length + i;
                    const isSelected = selectedIndex === index;

                    return (
                      <button
                        key={result.id}
                        onClick={() => handleSelect({ type: 'result', item: result, index })}
                        className={cn(
                          "w-full flex items-start gap-3 px-3 py-2 text-sm hover:bg-accent cursor-pointer transition-colors",
                          isSelected && "bg-accent"
                        )}
                      >
                        <div className="flex-1 text-left min-w-0">
                          <div className="font-medium truncate">{result.title}</div>
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {result.content}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground capitalize shrink-0">
                          {result.type}
                        </div>
                      </button>
                    );
                  })}

                  {/* See all results link */}
                  <button
                    onClick={() => {
                      router.push(`/search?q=${encodeURIComponent(query)}`);
                      setIsOpen(false);
                      setQuery("");
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-accent border-t mt-2"
                  >
                    <Search className="h-3 w-3" />
                    See all results
                  </button>
                </div>
              )}

              {/* Loading state */}
              {isLoading && query.length >= 2 && (
                <div className="flex items-center justify-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Searching...
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
