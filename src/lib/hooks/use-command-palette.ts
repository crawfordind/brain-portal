"use client";

import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileText,
  CheckSquare,
  Zap,
  Calendar,
  FolderKanban,
  FolderOpen,
  Search,
  StickyNote,
  LayoutGrid,
  BookOpen,
  type LucideIcon
} from 'lucide-react';
import type { CommandResult } from '@/lib/stores/command-store';

export interface UnifiedCommand {
  // Unique identifier
  id: string;

  // Voice command fields (existing)
  voiceTriggers: string[];
  voicePattern: RegExp;

  // Keyboard search fields (new)
  keywords: string[];
  label: string;
  description: string;
  icon: LucideIcon;
  shortcut?: string;

  // Unified execution
  category: 'creation' | 'navigation' | 'action' | 'search';
  handler: (params?: Record<string, any>) => Promise<void> | void;
}

export function useCommandPalette() {
  const router = useRouter();

  const commands: UnifiedCommand[] = useMemo(() => [
    // CREATION COMMANDS
    {
      id: 'create-note',
      voiceTriggers: ['new note', 'create note'],
      voicePattern: /(?:new|create)\s+(?:a\s+)?note(?:\s+(?:about\s+|titled\s+)?(.+))?/i,
      keywords: ['note', 'new', 'create', 'document', 'write'],
      label: 'New Note',
      description: 'Create a new note',
      icon: FileText,
      shortcut: 'Ctrl+N',
      category: 'creation',
      handler: async (params) => {
        if (params?.content) {
          router.push(`/notes/new?content=${encodeURIComponent(params.content)}`);
        } else {
          router.push('/notes/new');
        }
      },
    },
    {
      id: 'create-task',
      voiceTriggers: ['create task', 'new task', 'task to'],
      voicePattern: /(?:create|new)\s+(?:a\s+)?task(?:\s+(?:to\s+)?(.+))?/i,
      keywords: ['task', 'new', 'create', 'todo', 'checkbox'],
      label: 'New Task',
      description: 'Create a new task',
      icon: CheckSquare,
      category: 'creation',
      handler: async (params) => {
        if (params?.content) {
          router.push(`/tasks?new=${encodeURIComponent(params.content)}`);
        } else {
          router.push('/tasks?new=true');
        }
      },
    },
    {
      id: 'quick-capture',
      voiceTriggers: ['quick capture', 'capture'],
      voicePattern: /(?:quick\s+)?capture\s+(.+)/i,
      keywords: ['capture', 'quick', 'save', 'idea', 'thought'],
      label: 'Quick Capture',
      description: 'Capture a thought, link, or idea',
      icon: Zap,
      shortcut: '⌘⇧C',
      category: 'creation',
      handler: async () => {
        router.push('/');
      },
    },
    {
      id: 'daily-note',
      voiceTriggers: ['daily note', 'today note', 'open daily'],
      voicePattern: /(?:daily|today)\s+note/i,
      keywords: ['daily', 'today', 'journal', 'note'],
      label: "Today's Journal",
      description: "Create or open today's journal",
      icon: BookOpen,
      shortcut: '⌘⇧D',
      category: 'creation',
      handler: async () => {
        const today = new Date().toISOString().split('T')[0];
        router.push(`/journal?date=${today}`);
      },
    },
    {
      id: 'journal-entry',
      voiceTriggers: ['journal entry', 'start journal', 'new journal', 'journal post', 'today I'],
      voicePattern: /(?:(?:start|new|open|create)\s+(?:a\s+)?(?:journal|diary)|journal\s+(?:entry|post)|today\s+i\s+(.+))/i,
      keywords: ['journal', 'diary', 'log', 'entry', 'today'],
      label: 'New Journal Entry',
      description: 'Start a new journal entry for today',
      icon: BookOpen,
      shortcut: '⌘⇧J',
      category: 'creation',
      handler: async (params) => {
        if (params?.content) {
          router.push(`/journal?date=${new Date().toISOString().split('T')[0]}&entry=${encodeURIComponent(params.content)}`);
        } else {
          router.push(`/journal?date=${new Date().toISOString().split('T')[0]}&new=true`);
        }
      },
    },
    {
      id: 'add-to-today',
      voiceTriggers: ['add to today', 'add to daily note', 'add to journal'],
      voicePattern: /add\s+to\s+(?:today|daily\s+note|journal)\s+(.+)/i,
      keywords: ['today', 'daily', 'journal', 'add'],
      label: 'Add to Today',
      description: 'Add an entry to today\'s journal',
      icon: BookOpen,
      category: 'creation',
      handler: async (params) => {
        const today = new Date().toISOString().split('T')[0];
        if (params?.content) {
          router.push(`/journal?date=${today}&entry=${encodeURIComponent(params.content)}`);
        } else {
          router.push(`/journal?date=${today}`);
        }
      },
    },
    {
      id: 'monthly-journal',
      voiceTriggers: ['monthly journal', 'month review', 'monthly review'],
      voicePattern: /(?:monthly|month)\s+(?:journal|review|summary)/i,
      keywords: ['monthly', 'journal', 'review', 'summary', 'compile'],
      label: 'Monthly Journal',
      description: 'View or compile this month\'s journal',
      icon: BookOpen,
      category: 'navigation',
      handler: async () => {
        const now = new Date();
        router.push(`/journal?view=monthly&year=${now.getFullYear()}&month=${now.getMonth() + 1}`);
      },
    },
    {
      id: 'create-project',
      voiceTriggers: ['new project', 'create project'],
      voicePattern: /(?:new|create)\s+(?:a\s+)?project(?:\s+(?:called\s+)?(.+))?/i,
      keywords: ['project', 'new', 'create', 'folder'],
      label: 'New Project',
      description: 'Start a new project',
      icon: FolderKanban,
      category: 'creation',
      handler: async () => {
        router.push('/projects');
      },
    },

    // NAVIGATION COMMANDS
    {
      id: 'go-to-notes',
      voiceTriggers: ['go to notes', 'show notes'],
      voicePattern: /(?:go\s+to|show)\s+notes/i,
      keywords: ['notes', 'go', 'navigate', 'show', 'view'],
      label: 'Go to Notes',
      description: 'View all notes',
      icon: FileText,
      category: 'navigation',
      handler: () => {
        router.push('/notes');
      },
    },
    {
      id: 'go-to-tasks',
      voiceTriggers: ['go to tasks', 'show tasks'],
      voicePattern: /(?:go\s+to|show)\s+tasks/i,
      keywords: ['tasks', 'go', 'navigate', 'show', 'view', 'todo'],
      label: 'Go to Tasks',
      description: 'View all tasks',
      icon: CheckSquare,
      category: 'navigation',
      handler: () => {
        router.push('/tasks');
      },
    },
    {
      id: 'go-to-captures',
      voiceTriggers: ['go to captures', 'show captures', 'go to inbox', 'show inbox'],
      voicePattern: /(?:go\s+to|show)\s+(?:captures|inbox)/i,
      keywords: ['captures', 'inbox', 'go', 'navigate', 'show', 'view'],
      label: 'Go to Inbox',
      description: 'View captures and insights',
      icon: StickyNote,
      category: 'navigation',
      handler: () => {
        router.push('/inbox');
      },
    },
    {
      id: 'go-to-today',
      voiceTriggers: ['go to daily', 'go to today', 'show daily note', 'go to journal'],
      voicePattern: /(?:go\s+to|show)\s+(?:daily|today|daily\s+note|journal)/i,
      keywords: ['today', 'daily', 'journal', 'go', 'navigate'],
      label: 'Go to Journal',
      description: 'Open today\'s journal',
      icon: BookOpen,
      category: 'navigation',
      handler: () => {
        const today = new Date().toISOString().split('T')[0];
        router.push(`/journal?date=${today}`);
      },
    },
    {
      id: 'go-to-projects',
      voiceTriggers: ['go to projects', 'show projects'],
      voicePattern: /(?:go\s+to|show)\s+projects/i,
      keywords: ['projects', 'go', 'navigate', 'show', 'view', 'folders'],
      label: 'Go to Projects',
      description: 'View all projects',
      icon: FolderOpen,
      category: 'navigation',
      handler: () => {
        router.push('/projects');
      },
    },
    {
      id: 'go-to-search',
      voiceTriggers: ['search', 'find'],
      voicePattern: /(?:search|find)\s+(.+)/i,
      keywords: ['search', 'find', 'look', 'query'],
      label: 'Search Everything',
      description: 'Semantic search across all content',
      icon: Search,
      category: 'navigation',
      handler: (params) => {
        if (params?.content) {
          router.push(`/search?q=${encodeURIComponent(params.content)}`);
        } else {
          router.push('/search');
        }
      },
    },
    {
      id: 'go-to-insights',
      voiceTriggers: ['go to insights', 'show insights'],
      voicePattern: /(?:go\s+to|show)\s+insights/i,
      keywords: ['insights', 'connections', 'ai', 'suggestions'],
      label: 'Go to Insights',
      description: 'View AI-generated insights',
      icon: LayoutGrid,
      category: 'navigation',
      handler: () => {
        router.push('/insights');
      },
    },
  ], [router]);

  // Parse voice command from transcript
  const parseVoiceCommand = useCallback(
    (transcript: string): { command: UnifiedCommand; params: Record<string, any> } | null => {
      const normalizedTranscript = transcript.toLowerCase().trim();

      for (const command of commands) {
        const match = normalizedTranscript.match(command.voicePattern);

        if (match) {
          const params: Record<string, any> = {};

          // First capture group is typically the content
          if (match[1]) {
            params.content = match[1].trim();
          }

          return { command, params };
        }
      }

      return null;
    },
    [commands]
  );

  // Search commands by keywords (for typed palette)
  const searchCommands = useCallback(
    (query: string): CommandResult[] => {
      if (!query) return [];

      const normalizedQuery = query.toLowerCase().trim();
      const results: CommandResult[] = [];

      for (const command of commands) {
        // Check if any keyword matches
        const keywordMatch = command.keywords.some(
          (keyword) => keyword.toLowerCase().includes(normalizedQuery)
        );

        // Check if label matches
        const labelMatch = command.label.toLowerCase().includes(normalizedQuery);

        // Check if description matches
        const descriptionMatch = command.description.toLowerCase().includes(normalizedQuery);

        if (keywordMatch || labelMatch || descriptionMatch) {
          results.push({
            id: command.id,
            type: 'command',
            label: command.label,
            description: command.description,
            icon: command.icon,
            section: 'commands',
            handler: () => command.handler(),
          });
        }
      }

      return results;
    },
    [commands]
  );

  // Get quick actions (top 5 most common commands)
  const getQuickActions = useCallback((): UnifiedCommand[] => {
    return [
      commands.find(c => c.id === 'quick-capture')!,
      commands.find(c => c.id === 'journal-entry')!,
      commands.find(c => c.id === 'daily-note')!,
      commands.find(c => c.id === 'create-note')!,
      commands.find(c => c.id === 'create-task')!,
      commands.find(c => c.id === 'create-project')!,
    ];
  }, [commands]);

  // Execute command by ID
  const executeCommandById = useCallback(
    async (commandId: string, params?: Record<string, any>) => {
      const command = commands.find(c => c.id === commandId);
      if (command) {
        await command.handler(params);
      }
    },
    [commands]
  );

  return {
    commands,
    parseVoiceCommand,
    searchCommands,
    getQuickActions,
    executeCommandById,
  };
}
