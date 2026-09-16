// src/lib/cleanup/applier.ts
import type { CleanupSuggestion, TaskRecommendationInput, ApplyResult } from './types';
import { findBestMatch } from './fuzzy-match';

export function applySuggestions(
  noteContent: string,
  suggestions: CleanupSuggestion[],
  noteId?: string
): ApplyResult {
  let content = noteContent;
  const taskRecommendations: TaskRecommendationInput[] = [];
  const suggestedTags: string[] = [];

  // Sort suggestions by type priority
  const sorted = suggestions.sort((a, b) => {
    const priority: Record<string, number> = { extract: 0, replace: 1, insert: 2, add: 3 };
    return priority[a.action] - priority[b.action];
  });

  for (const suggestion of sorted) {
    switch (suggestion.type) {
      case 'structure':
      case 'duplicate':
        if (suggestion.action === 'replace' && suggestion.before && suggestion.after) {
          // FIX: Use replaceAll to handle multiple occurrences
          if (content.includes(suggestion.before)) {
            content = content.replaceAll(suggestion.before, suggestion.after);
          }
        } else if (suggestion.action === 'insert' && suggestion.after) {
          const result = insertAtTarget(content, suggestion.target, suggestion.after);
          content = result.content;
          // Note: matchConfidence could be logged or returned for UI feedback
        }
        break;

      case 'task':
        if (suggestion.action === 'extract' && suggestion.content) {
          // Create task recommendation
          taskRecommendations.push({
            source_type: 'note',
            source_id: noteId || '',
            source_text: suggestion.target || suggestion.content,
            recommended_task: suggestion.content,
            reasoning: suggestion.reasoning || 'Extracted during note cleanup',
            confidence: suggestion.confidence || 0.8,
            priority: 'medium',
          });

          // FIX: Use replaceAll to remove all occurrences
          if (suggestion.target && content.includes(suggestion.target)) {
            content = content.replaceAll(suggestion.target, '');
          }
        }
        break;

      case 'tag':
        if (suggestion.action === 'add' && suggestion.content) {
          suggestedTags.push(suggestion.content);
        }
        break;
    }
  }

  // Clean up any double newlines created by removals
  content = content.replace(/\n{3,}/g, '\n\n');

  return {
    updatedContent: content.trim(),
    taskRecommendations,
    suggestedTags,
  };
}

function insertAtTarget(content: string, target: string, insertion: string): {
  content: string;
  matchConfidence?: number;
  matchedTarget?: string;
} {
  // Try exact match first
  if (target && content.includes(target)) {
    return {
      content: content.replace(target, target + '\n\n' + insertion),
      matchConfidence: 1.0,
      matchedTarget: target,
    };
  }

  // Try fuzzy match
  const fuzzyMatch = findBestMatch(content, target, 0.7);
  if (fuzzyMatch) {
    console.log(`Fuzzy match found for target "${target}": "${fuzzyMatch.match}" (similarity: ${fuzzyMatch.similarity})`);
    return {
      content: content.replace(fuzzyMatch.match, fuzzyMatch.match + '\n\n' + insertion),
      matchConfidence: fuzzyMatch.similarity,
      matchedTarget: fuzzyMatch.match,
    };
  }

  // No match found - log warning and skip insertion
  console.warn(`No match found for target "${target}" - skipping insertion to avoid appending at end`);
  return {
    content,
    matchConfidence: 0,
    matchedTarget: undefined,
  };
}
