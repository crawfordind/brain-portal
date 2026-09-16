"use client";

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { parseNaturalLanguageTask } from '@/lib/tasks/nl-parser';

export type CommandCategory = 'creation' | 'navigation' | 'action' | 'punctuation';

export interface VoiceCommand {
  trigger: string[];
  pattern: RegExp;
  category: CommandCategory;
  handler: (params: Record<string, any>) => Promise<any> | any;
  requiredContext?: string[];
  description: string;
}

export interface CommandMatch {
  command: VoiceCommand;
  params: Record<string, any>;
  confidence: number;
}

export function useVoiceCommands() {
  const router = useRouter();

  const commands: VoiceCommand[] = [
    // Creation commands
    {
      trigger: ['voice note', 'voice memo'],
      pattern: /(?:voice\s+(?:note|memo))(?:\s+(?:about\s+)?(.+))?/i,
      category: 'creation',
      description: 'Create a voice note that saves your thoughts as a note',
      handler: async ({ content }) => {
        const title = content || 'Voice Note';
        const noteContent = content || '';
        try {
          const response = await fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: title.length > 60 ? title.substring(0, 57) + '...' : title,
              content: noteContent,
              metadata: JSON.stringify({
                source: 'voice',
                transcript: noteContent,
                recorded_at: new Date().toISOString(),
              }),
            }),
          });
          const data = await response.json();
          if (data.note) {
            router.push(`/notes/${data.note.slug}`);
          }
        } catch (error) {
          console.error('Failed to create voice note:', error);
          router.push('/notes/new');
        }
      },
    },
    {
      trigger: ['new note', 'create note'],
      pattern: /(?:new|create)\s+(?:a\s+)?note(?:\s+(?:about\s+|titled\s+)?(.+))?/i,
      category: 'creation',
      description: 'Create a new note with optional title/content',
      handler: async ({ content }) => {
        if (content) {
          // Create the note via API with content as both title and initial content
          try {
            const response = await fetch('/api/notes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: content,
                content: content // Also set as content so it's in the note body
              }),
            });
            const data = await response.json();
            if (data.note) {
              router.push(`/notes/${data.note.slug}`);
            }
          } catch (error) {
            console.error('Failed to create note:', error);
            router.push('/notes/new');
          }
        } else {
          router.push('/notes/new');
        }
      },
    },
    {
      trigger: ['create task', 'new task', 'task to'],
      pattern: /(?:create|new)\s+(?:a\s+)?task(?:\s+(?:to\s+)?(.+))?/i,
      category: 'creation',
      description: 'Create a new task with optional description',
      handler: async ({ content }) => {
        if (content) {
          // Parse natural language to extract structured fields
          const parsed = parseNaturalLanguageTask(content);
          try {
            const response = await fetch('/api/tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                content: parsed.title || content,
                priority: parsed.priority,
                dueDate: parsed.dueDate,
                recurrenceRule: parsed.recurrenceRule,
              }),
            });
            if (response.ok) {
              await response.json();
              router.push('/tasks');
              return { type: 'create-task', success: true };
            } else {
              console.error('Failed to create task');
              return { type: 'create-task', success: false };
            }
          } catch (error) {
            console.error('Failed to create task:', error);
            return { type: 'create-task', success: false, error };
          }
        } else {
          router.push('/tasks');
          return { type: 'create-task', content };
        }
      },
    },
    {
      trigger: ['quick capture', 'capture'],
      pattern: /(?:quick\s+)?capture\s+(.+)/i,
      category: 'creation',
      description: 'Create a quick capture',
      handler: async ({ content }) => {
        if (content) {
          // Create the capture via API
          try {
            const response = await fetch('/api/captures', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content, captureType: 'thought' }),
            });
            if (response.ok) {
              await response.json();
              return { type: 'capture', success: true };
            } else {
              console.error('Failed to create capture');
              return { type: 'capture', success: false };
            }
          } catch (error) {
            console.error('Failed to create capture:', error);
            return { type: 'capture', success: false, error };
          }
        }
        return { type: 'capture', content };
      },
    },
    {
      trigger: ['add to today', 'add to daily note'],
      pattern: /add\s+to\s+(?:today|daily\s+note)\s+(.+)/i,
      category: 'creation',
      description: 'Add content to today\'s daily note',
      handler: async ({ content }) => {
        // Get or create today's daily note through API
        const today = new Date().toISOString().split('T')[0];
        try {
          const response = await fetch(`/api/daily?date=${today}`);
          const data = await response.json();
          if (data.note) {
            router.push(`/notes/${data.note.slug}?append=${encodeURIComponent(content)}`);
          }
        } catch (error) {
          console.error('Failed to get daily note:', error);
          router.push('/notes');
        }
      },
    },
    {
      trigger: ['add to current note', 'add to note'],
      pattern: /add\s+to\s+(?:current\s+)?note\s+(.+)/i,
      category: 'creation',
      description: 'Add content to the currently open note',
      handler: async ({ content }) => {
        // This will be handled by the editor integration
        return { type: 'append', content };
      },
    },

    // Navigation commands
    {
      trigger: ['go to notes', 'show notes'],
      pattern: /(?:go\s+to|show)\s+notes/i,
      category: 'navigation',
      description: 'Navigate to notes page',
      handler: () => {
        router.push('/notes');
      },
    },
    {
      trigger: ['go to captures', 'show captures', 'go to inbox'],
      pattern: /(?:go\s+to|show)\s+(?:captures|inbox)/i,
      category: 'navigation',
      description: 'Navigate to inbox (captures and insights)',
      handler: () => {
        router.push('/');
      },
    },
    {
      trigger: ['go to tasks', 'show tasks'],
      pattern: /(?:go\s+to|show)\s+tasks/i,
      category: 'navigation',
      description: 'Navigate to tasks page',
      handler: () => {
        router.push('/tasks');
      },
    },
    {
      trigger: ['go to daily', 'go to today', 'show daily note'],
      pattern: /(?:go\s+to|show)\s+(?:daily|today|daily\s+note)/i,
      category: 'navigation',
      description: 'Navigate to today\'s daily note',
      handler: async () => {
        // Get or create today's daily note through API
        const today = new Date().toISOString().split('T')[0];
        try {
          const response = await fetch(`/api/daily?date=${today}`);
          const data = await response.json();
          if (data.note) {
            router.push(`/notes/${data.note.slug}`);
          } else {
            // Create it if it doesn't exist
            const createResponse = await fetch('/api/daily', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ date: today }),
            });
            const createData = await createResponse.json();
            if (createData.note) {
              router.push(`/notes/${createData.note.slug}`);
            }
          }
        } catch (error) {
          console.error('Failed to get daily note:', error);
          router.push('/notes');
        }
      },
    },

    // Action commands
    {
      trigger: ['save', 'save and close'],
      pattern: /save(?:\s+and\s+close)?/i,
      category: 'action',
      description: 'Save the current item',
      handler: () => {
        return { type: 'save' };
      },
    },
    {
      trigger: ['cancel', 'discard'],
      pattern: /(?:cancel|discard)/i,
      category: 'action',
      description: 'Cancel and discard changes',
      handler: () => {
        return { type: 'cancel' };
      },
    },
    {
      trigger: ['tag as'],
      pattern: /tag\s+as\s+(.+)/i,
      category: 'action',
      description: 'Add a tag to the current item',
      handler: ({ content }) => {
        return { type: 'tag', tag: content };
      },
    },

    // Punctuation commands
    {
      trigger: ['period', 'full stop'],
      pattern: /(?:period|full\s+stop)/i,
      category: 'punctuation',
      description: 'Insert a period',
      handler: () => {
        return { type: 'punctuation', mark: '.' };
      },
    },
    {
      trigger: ['comma'],
      pattern: /comma/i,
      category: 'punctuation',
      description: 'Insert a comma',
      handler: () => {
        return { type: 'punctuation', mark: ',' };
      },
    },
    {
      trigger: ['question mark'],
      pattern: /question\s+mark/i,
      category: 'punctuation',
      description: 'Insert a question mark',
      handler: () => {
        return { type: 'punctuation', mark: '?' };
      },
    },
    {
      trigger: ['exclamation mark', 'exclamation point'],
      pattern: /exclamation\s+(?:mark|point)/i,
      category: 'punctuation',
      description: 'Insert an exclamation mark',
      handler: () => {
        return { type: 'punctuation', mark: '!' };
      },
    },
    {
      trigger: ['new line', 'line break'],
      pattern: /(?:new\s+line|line\s+break)/i,
      category: 'punctuation',
      description: 'Insert a line break',
      handler: () => {
        return { type: 'punctuation', mark: '\n' };
      },
    },
    {
      trigger: ['new paragraph'],
      pattern: /new\s+paragraph/i,
      category: 'punctuation',
      description: 'Insert a paragraph break',
      handler: () => {
        return { type: 'punctuation', mark: '\n\n' };
      },
    },
    {
      trigger: ['dash'],
      pattern: /dash/i,
      category: 'punctuation',
      description: 'Insert a dash',
      handler: () => {
        return { type: 'punctuation', mark: '-' };
      },
    },
    {
      trigger: ['bullet point'],
      pattern: /bullet\s+point/i,
      category: 'punctuation',
      description: 'Insert a bullet point',
      handler: () => {
        return { type: 'punctuation', mark: '•' };
      },
    },
  ];

  const parseCommand = useCallback(
    (transcript: string): CommandMatch | null => {
      const normalizedTranscript = transcript.toLowerCase().trim();

      // Try to match each command
      for (const command of commands) {
        const match = normalizedTranscript.match(command.pattern);

        if (match) {
          // Extract parameters from the match
          const params: Record<string, any> = {};

          // First capture group is typically the content
          if (match[1]) {
            params.content = match[1].trim();
          }

          // Calculate confidence based on trigger phrase presence
          let confidence = 0.8;
          const hasExactTrigger = command.trigger.some((trigger) =>
            normalizedTranscript.includes(trigger)
          );
          if (hasExactTrigger) {
            confidence = 0.95;
          }

          return {
            command,
            params,
            confidence,
          };
        }
      }

      return null;
    },
    [commands]
  );

  const executeCommand = useCallback(
    async (match: CommandMatch): Promise<any> => {
      try {
        const result = await match.command.handler(match.params);
        return { success: true, result };
      } catch (error) {
        console.error('Command execution error:', error);
        return { success: false, error };
      }
    },
    []
  );

  const getCommandsByCategory = useCallback(
    (category?: CommandCategory) => {
      if (!category) return commands;
      return commands.filter((cmd) => cmd.category === category);
    },
    [commands]
  );

  const getAllCommands = useCallback(() => commands, [commands]);

  return {
    parseCommand,
    executeCommand,
    getCommandsByCategory,
    getAllCommands,
    commands,
  };
}
