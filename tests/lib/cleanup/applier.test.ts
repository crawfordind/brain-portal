// tests/lib/cleanup/applier.test.ts
import { describe, test, expect } from 'vitest';
import { applySuggestions } from '@/lib/cleanup/applier';
import type { CleanupSuggestion } from '@/lib/cleanup/types';

describe('applySuggestions', () => {
  test('applies structure replacements', () => {
    const content = '## Old Heading\n\nSome content';
    const suggestions: CleanupSuggestion[] = [
      {
        id: 'struct-1',
        type: 'structure',
        action: 'replace',
        target: '## Old Heading',
        before: '## Old Heading',
        after: '## Improved Heading',
        reasoning: 'Better',
        confidence: 0.9
      }
    ];

    const result = applySuggestions(content, suggestions);

    expect(result.updatedContent).toContain('## Improved Heading');
    expect(result.updatedContent).not.toContain('## Old Heading');
  });

  test('extracts tasks', () => {
    const content = 'Notes here\n- Call Sarah tomorrow\nMore notes';
    const suggestions: CleanupSuggestion[] = [
      {
        id: 'task-1',
        type: 'task',
        action: 'extract',
        target: '- Call Sarah tomorrow',
        content: 'Call Sarah tomorrow',
        reasoning: 'Action item',
        confidence: 0.95
      }
    ];

    const result = applySuggestions(content, suggestions);

    expect(result.taskRecommendations).toHaveLength(1);
    expect(result.taskRecommendations[0].recommended_task).toBe('Call Sarah tomorrow');
    expect(result.updatedContent).not.toContain('- Call Sarah tomorrow');
  });

  test('adds tags', () => {
    const content = 'Some content';
    const suggestions: CleanupSuggestion[] = [
      {
        id: 'tag-1',
        type: 'tag',
        action: 'add',
        content: 'project-planning',
        target: '',
        reasoning: 'Relevant tag',
        confidence: 0.8
      }
    ];

    const result = applySuggestions(content, suggestions);

    expect(result.suggestedTags).toContain('project-planning');
  });

  test('cleans up multiple newlines', () => {
    const content = 'Line 1\n- Task here\n\nLine 2';
    const suggestions: CleanupSuggestion[] = [
      {
        id: 'task-1',
        type: 'task',
        action: 'extract',
        target: '- Task here',
        content: 'Task here',
        reasoning: 'Extract',
        confidence: 0.9
      }
    ];

    const result = applySuggestions(content, suggestions);

    expect(result.updatedContent).not.toMatch(/\n{3,}/);
  });

  // NEW: Test replaceAll for multiple occurrences
  test('replaces all occurrences of duplicate content', () => {
    const content = 'Point A\n\nPoint A\n\nPoint B';
    const suggestions: CleanupSuggestion[] = [
      {
        id: 'dup-1',
        type: 'duplicate',
        action: 'replace',
        target: 'Point A',
        before: 'Point A',
        after: 'Consolidated Point',
        reasoning: 'Remove duplication',
        confidence: 0.9
      }
    ];

    const result = applySuggestions(content, suggestions);

    expect(result.updatedContent).not.toContain('Point A');
    expect((result.updatedContent.match(/Consolidated Point/g) || []).length).toBe(2);
  });

  // NEW: Test insert action
  test('inserts content at target location', () => {
    const content = '## Section 1\n\nContent here';
    const suggestions: CleanupSuggestion[] = [
      {
        id: 'struct-1',
        type: 'structure',
        action: 'insert',
        target: '## Section 1',
        after: '**Summary:** Important info',
        reasoning: 'Add summary',
        confidence: 0.85
      }
    ];

    const result = applySuggestions(content, suggestions);

    expect(result.updatedContent).toContain('**Summary:** Important info');
    // Should be after the target
    const targetIndex = result.updatedContent.indexOf('## Section 1');
    const summaryIndex = result.updatedContent.indexOf('**Summary:**');
    expect(summaryIndex).toBeGreaterThan(targetIndex);
  });

  // NEW: Test priority sorting
  test('processes suggestions in priority order', () => {
    const content = 'Original\n- Task item';
    const suggestions: CleanupSuggestion[] = [
      {
        id: 'tag-1',
        type: 'tag',
        action: 'add',
        content: 'test-tag',
        target: '',
        reasoning: 'Tag',
        confidence: 0.8
      },
      {
        id: 'task-1',
        type: 'task',
        action: 'extract',
        target: '- Task item',
        content: 'Task item',
        reasoning: 'Task',
        confidence: 0.9
      },
      {
        id: 'struct-1',
        type: 'structure',
        action: 'replace',
        target: 'Original',
        before: 'Original',
        after: 'Modified',
        reasoning: 'Replace',
        confidence: 0.85
      }
    ];

    const result = applySuggestions(content, suggestions);

    // Extract should happen first (remove task), then replace
    expect(result.updatedContent).not.toContain('- Task item');
    expect(result.updatedContent).toContain('Modified');
    expect(result.taskRecommendations).toHaveLength(1);
    expect(result.suggestedTags).toContain('test-tag');
  });
});
