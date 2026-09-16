import * as chrono from 'chrono-node';
import { format } from 'date-fns';
import { hasActionIndicators, hasTimeLanguage } from '@/lib/recommendations/utils';
import { validateDueDate } from './date-utils';

export interface ProjectOption {
  id: string;
  name: string;
}

export interface ParsedTask {
  title: string;
  dueDate: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  projectId: string | null;
  projectName: string | null;
  recurrenceRule: string | null;
  confidence: number;
  parsedFields: string[];
}

const PRIORITY_PATTERNS: Array<{ pattern: RegExp; value: ParsedTask['priority'] }> = [
  { pattern: /\b(?:urgent|asap|critical|immediately)\b/i, value: 'urgent' },
  { pattern: /\b(?:high\s+priority|important|high\s+pri)\b/i, value: 'high' },
  { pattern: /\b(?:low\s+priority|no\s+rush|low\s+pri|whenever)\b/i, value: 'low' },
];

const RECURRENCE_PATTERNS: Array<{ pattern: RegExp; rule: string }> = [
  { pattern: /\bevery\s+day\b/i, rule: 'FREQ=DAILY;INTERVAL=1' },
  { pattern: /\bdaily\b/i, rule: 'FREQ=DAILY;INTERVAL=1' },
  { pattern: /\bevery\s+week\b/i, rule: 'FREQ=WEEKLY;INTERVAL=1' },
  { pattern: /\bweekly\b/i, rule: 'FREQ=WEEKLY;INTERVAL=1' },
  { pattern: /\bevery\s+month\b/i, rule: 'FREQ=MONTHLY;INTERVAL=1' },
  { pattern: /\bmonthly\b/i, rule: 'FREQ=MONTHLY;INTERVAL=1' },
  { pattern: /\bevery\s+(\d+)\s+days?\b/i, rule: 'FREQ=DAILY;INTERVAL=$1' },
  { pattern: /\bevery\s+(\d+)\s+weeks?\b/i, rule: 'FREQ=WEEKLY;INTERVAL=$1' },
  { pattern: /\bevery\s+monday\b/i, rule: 'FREQ=WEEKLY;BYDAY=MO' },
  { pattern: /\bevery\s+tuesday\b/i, rule: 'FREQ=WEEKLY;BYDAY=TU' },
  { pattern: /\bevery\s+wednesday\b/i, rule: 'FREQ=WEEKLY;BYDAY=WE' },
  { pattern: /\bevery\s+thursday\b/i, rule: 'FREQ=WEEKLY;BYDAY=TH' },
  { pattern: /\bevery\s+friday\b/i, rule: 'FREQ=WEEKLY;BYDAY=FR' },
  { pattern: /\bevery\s+saturday\b/i, rule: 'FREQ=WEEKLY;BYDAY=SA' },
  { pattern: /\bevery\s+sunday\b/i, rule: 'FREQ=WEEKLY;BYDAY=SU' },
];

const PREFIX_PATTERNS = [
  /^(?:remind\s+me\s+to)\s+/i,
  /^(?:i\s+need\s+to)\s+/i,
  /^(?:i\s+have\s+to)\s+/i,
  /^(?:i\s+should)\s+/i,
  /^(?:don't\s+forget\s+to)\s+/i,
  /^(?:task\s*:\s*)/i,
  /^(?:todo\s*:\s*)/i,
  /^(?:create\s+(?:a\s+)?task\s+(?:to\s+)?)/i,
  /^(?:new\s+task\s+(?:to\s+)?)/i,
  /^(?:add\s+(?:a\s+)?task\s+(?:to\s+)?)/i,
];

export function parseNaturalLanguageTask(
  rawText: string,
  projects?: ProjectOption[]
): ParsedTask {
  const parsedFields: string[] = [];
  let text = rawText.trim();

  if (!text) {
    return {
      title: '',
      dueDate: null,
      priority: 'medium',
      projectId: null,
      projectName: null,
      recurrenceRule: null,
      confidence: 0,
      parsedFields: [],
    };
  }

  // 1. Extract recurrence BEFORE date parsing (to avoid chrono misinterpreting "every Monday")
  let recurrenceRule: string | null = null;
  for (const { pattern, rule } of RECURRENCE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      recurrenceRule = rule;
      // Handle dynamic intervals like "every 3 days"
      if (match[1]) {
        recurrenceRule = rule.replace('$1', match[1]);
      }
      text = text.replace(match[0], ' ').trim();
      parsedFields.push('recurrenceRule');
      break;
    }
  }

  // 2. Extract dates with chrono
  let dueDate: string | null = null;
  const refDate = new Date();
  const chronoResults = chrono.parse(text, refDate, { forwardDate: true });

  if (chronoResults.length > 0) {
    const result = chronoResults[0];
    const date = result.start.date();
    // Always strip the recognized date text from the title, even if we reject
    // the value below — the words were still a date reference, not the task.
    text = text.replace(result.text, ' ').trim();
    // Bound-check: drop dates in the past or implausibly far out (chrono can
    // lift a stray year like "...2005" out of body text).
    const validated = validateDueDate(format(date, 'yyyy-MM-dd'), refDate);
    if (validated) {
      dueDate = validated;
      parsedFields.push('dueDate');
    }
  }

  // 3. Extract priority
  let priority: ParsedTask['priority'] = 'medium';
  for (const { pattern, value } of PRIORITY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      priority = value;
      text = text.replace(match[0], ' ').trim();
      parsedFields.push('priority');
      break;
    }
  }

  // 4. Match project names (longest match wins, word-boundary, case-insensitive)
  let projectId: string | null = null;
  let projectName: string | null = null;
  if (projects && projects.length > 0) {
    const sorted = [...projects].sort((a, b) => b.name.length - a.name.length);
    for (const project of sorted) {
      const escaped = project.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const projectPattern = new RegExp(`\\b(?:for\\s+)?${escaped}\\b`, 'i');
      const match = text.match(projectPattern);
      if (match) {
        projectId = project.id;
        projectName = project.name;
        text = text.replace(match[0], ' ').trim();
        parsedFields.push('projectId');
        break;
      }
    }
  }

  // 5. Strip prefixes
  for (const pattern of PREFIX_PATTERNS) {
    text = text.replace(pattern, '').trim();
  }

  // 6. Clean up title
  let title = text
    .replace(/\s{2,}/g, ' ')  // collapse multiple spaces
    .replace(/^[,.\s]+/, '')   // strip leading punctuation
    .replace(/[,.\s]+$/, '')   // strip trailing punctuation
    .trim();

  // Capitalize first letter
  if (title.length > 0) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }

  // 7. Score confidence
  const lowerRaw = rawText.toLowerCase();
  let confidence = 0;

  if (hasActionIndicators(lowerRaw)) confidence += 0.4;
  if (hasTimeLanguage(lowerRaw)) confidence += 0.3;
  if (parsedFields.includes('dueDate')) confidence += 0.15;
  if (parsedFields.includes('priority')) confidence += 0.1;
  if (parsedFields.includes('recurrenceRule')) confidence += 0.1;
  if (parsedFields.includes('projectId')) confidence += 0.05;

  // Baseline: if title is non-empty and has action-like words
  if (title.length > 0 && confidence === 0) {
    // Check for imperative verb at start (common task pattern)
    if (/^(?:call|buy|send|write|fix|update|check|review|finish|complete|submit|prepare|clean|organize|meet|pick\s+up|get|make|set\s+up|schedule|book|cancel|pay|file|return|renew)/i.test(title)) {
      confidence += 0.5;
    }
  }

  confidence = Math.min(confidence, 1);

  return {
    title,
    dueDate,
    priority,
    projectId,
    projectName,
    recurrenceRule,
    confidence,
    parsedFields,
  };
}
