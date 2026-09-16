import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseNaturalLanguageTask } from '@/lib/tasks/nl-parser';
import { format, addDays, nextMonday, nextTuesday, nextFriday } from 'date-fns';

describe('parseNaturalLanguageTask', () => {
  describe('date parsing', () => {
    it('should parse "tomorrow"', () => {
      const result = parseNaturalLanguageTask('buy groceries tomorrow');
      const expected = format(addDays(new Date(), 1), 'yyyy-MM-dd');
      expect(result.dueDate).toBe(expected);
      expect(result.parsedFields).toContain('dueDate');
    });

    it('should parse "next Tuesday"', () => {
      const result = parseNaturalLanguageTask('call John next Tuesday');
      expect(result.dueDate).not.toBeNull();
      expect(result.parsedFields).toContain('dueDate');
    });

    it('should parse "in 3 days"', () => {
      const result = parseNaturalLanguageTask('finish report in 3 days');
      const expected = format(addDays(new Date(), 3), 'yyyy-MM-dd');
      expect(result.dueDate).toBe(expected);
    });

    it('should parse "by Friday"', () => {
      const result = parseNaturalLanguageTask('submit expenses by Friday');
      expect(result.dueDate).not.toBeNull();
      expect(result.parsedFields).toContain('dueDate');
    });

    it('should parse specific date "March 15"', () => {
      const result = parseNaturalLanguageTask('dentist appointment March 15');
      expect(result.dueDate).not.toBeNull();
      expect(result.dueDate).toMatch(/\d{4}-03-15/);
    });

    it('should strip date text from title', () => {
      const result = parseNaturalLanguageTask('buy groceries tomorrow');
      expect(result.title.toLowerCase()).not.toContain('tomorrow');
    });

    it('should reject an explicit past date but still strip it from the title', () => {
      const result = parseNaturalLanguageTask('file court docket March 9 2005');
      expect(result.dueDate).toBeNull();
      expect(result.parsedFields).not.toContain('dueDate');
      expect(result.title.toLowerCase()).not.toContain('2005');
    });
  });

  describe('priority detection', () => {
    it('should detect "urgent"', () => {
      const result = parseNaturalLanguageTask('fix server crash urgent');
      expect(result.priority).toBe('urgent');
      expect(result.parsedFields).toContain('priority');
    });

    it('should detect "asap"', () => {
      const result = parseNaturalLanguageTask('deploy hotfix asap');
      expect(result.priority).toBe('urgent');
    });

    it('should detect "high priority"', () => {
      const result = parseNaturalLanguageTask('review PR high priority');
      expect(result.priority).toBe('high');
    });

    it('should detect "important"', () => {
      const result = parseNaturalLanguageTask('important meeting prep');
      expect(result.priority).toBe('high');
    });

    it('should detect "low priority"', () => {
      const result = parseNaturalLanguageTask('clean desk low priority');
      expect(result.priority).toBe('low');
    });

    it('should detect "no rush"', () => {
      const result = parseNaturalLanguageTask('organize bookmarks no rush');
      expect(result.priority).toBe('low');
    });

    it('should default to medium when no priority specified', () => {
      const result = parseNaturalLanguageTask('buy milk');
      expect(result.priority).toBe('medium');
    });

    it('should strip priority text from title', () => {
      const result = parseNaturalLanguageTask('fix bug high priority');
      expect(result.title.toLowerCase()).not.toContain('high priority');
    });
  });

  describe('recurrence detection', () => {
    it('should detect "daily"', () => {
      const result = parseNaturalLanguageTask('standup daily');
      expect(result.recurrenceRule).toBe('FREQ=DAILY;INTERVAL=1');
      expect(result.parsedFields).toContain('recurrenceRule');
    });

    it('should detect "every day"', () => {
      const result = parseNaturalLanguageTask('take vitamins every day');
      expect(result.recurrenceRule).toBe('FREQ=DAILY;INTERVAL=1');
    });

    it('should detect "weekly"', () => {
      const result = parseNaturalLanguageTask('weekly team sync');
      expect(result.recurrenceRule).toBe('FREQ=WEEKLY;INTERVAL=1');
    });

    it('should detect "every Monday"', () => {
      const result = parseNaturalLanguageTask('standup every Monday');
      expect(result.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO');
    });

    it('should detect "every 3 days"', () => {
      const result = parseNaturalLanguageTask('water plants every 3 days');
      expect(result.recurrenceRule).toBe('FREQ=DAILY;INTERVAL=3');
    });

    it('should detect "monthly"', () => {
      const result = parseNaturalLanguageTask('pay rent monthly');
      expect(result.recurrenceRule).toBe('FREQ=MONTHLY;INTERVAL=1');
    });

    it('should strip recurrence text from title', () => {
      const result = parseNaturalLanguageTask('standup every Monday');
      expect(result.title.toLowerCase()).not.toContain('every monday');
    });
  });

  describe('project matching', () => {
    const projects = [
      { id: '1', name: 'Brain Portal' },
      { id: '2', name: 'Marketing' },
      { id: '3', name: 'Q1 Planning' },
    ];

    it('should match project name (case-insensitive)', () => {
      const result = parseNaturalLanguageTask(
        'fix login bug for brain portal',
        projects
      );
      expect(result.projectId).toBe('1');
      expect(result.projectName).toBe('Brain Portal');
      expect(result.parsedFields).toContain('projectId');
    });

    it('should match with "for" prefix', () => {
      const result = parseNaturalLanguageTask(
        'update landing page for Marketing',
        projects
      );
      expect(result.projectId).toBe('2');
    });

    it('should prefer longest match', () => {
      const projectsOverlap = [
        { id: '1', name: 'Portal' },
        { id: '2', name: 'Brain Portal' },
      ];
      const result = parseNaturalLanguageTask(
        'fix bug in Brain Portal',
        projectsOverlap
      );
      expect(result.projectId).toBe('2');
    });

    it('should strip project name from title', () => {
      const result = parseNaturalLanguageTask(
        'fix bug for Brain Portal',
        projects
      );
      expect(result.title.toLowerCase()).not.toContain('brain portal');
    });

    it('should return null when no project matches', () => {
      const result = parseNaturalLanguageTask('buy groceries', projects);
      expect(result.projectId).toBeNull();
      expect(result.projectName).toBeNull();
    });
  });

  describe('title cleanup', () => {
    it('should strip "remind me to" prefix', () => {
      const result = parseNaturalLanguageTask('remind me to call dentist');
      expect(result.title).toBe('Call dentist');
    });

    it('should strip "I need to" prefix', () => {
      const result = parseNaturalLanguageTask('I need to finish the report');
      expect(result.title).toBe('Finish the report');
    });

    it('should strip "task:" prefix', () => {
      const result = parseNaturalLanguageTask('task: update documentation');
      expect(result.title).toBe('Update documentation');
    });

    it('should strip "create task to" prefix', () => {
      const result = parseNaturalLanguageTask('create task to buy groceries');
      expect(result.title).toBe('Buy groceries');
    });

    it('should capitalize first letter', () => {
      const result = parseNaturalLanguageTask('buy milk');
      expect(result.title).toBe('Buy milk');
    });

    it('should collapse multiple spaces', () => {
      const result = parseNaturalLanguageTask(
        'buy   groceries   tomorrow'
      );
      expect(result.title).not.toMatch(/\s{2,}/);
    });
  });

  describe('combined parsing', () => {
    it('should parse date + priority', () => {
      const result = parseNaturalLanguageTask(
        'finish report by Friday high priority'
      );
      expect(result.dueDate).not.toBeNull();
      expect(result.priority).toBe('high');
      expect(result.title.toLowerCase()).not.toContain('high priority');
    });

    it('should parse date + priority + project', () => {
      const projects = [{ id: '1', name: 'Brain Portal' }];
      const result = parseNaturalLanguageTask(
        'fix auth bug tomorrow urgent for Brain Portal',
        projects
      );
      expect(result.dueDate).not.toBeNull();
      expect(result.priority).toBe('urgent');
      expect(result.projectId).toBe('1');
      expect(result.title).toMatch(/fix auth bug/i);
    });

    it('should parse recurrence + project', () => {
      const projects = [{ id: '1', name: 'Brain Portal' }];
      const result = parseNaturalLanguageTask(
        'weekly standup for Brain Portal',
        projects
      );
      expect(result.recurrenceRule).toBe('FREQ=WEEKLY;INTERVAL=1');
      expect(result.projectId).toBe('1');
    });

    it('should handle prefix + date + priority', () => {
      const result = parseNaturalLanguageTask(
        'remind me to call John next Tuesday high priority'
      );
      expect(result.dueDate).not.toBeNull();
      expect(result.priority).toBe('high');
      expect(result.title).toMatch(/call john/i);
    });
  });

  describe('confidence scoring', () => {
    it('should give high confidence for action verbs + time language', () => {
      const result = parseNaturalLanguageTask(
        'need to finish report by tomorrow'
      );
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should give moderate confidence for just action verbs', () => {
      const result = parseNaturalLanguageTask('review the PR');
      expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it('should give confidence for imperative verbs', () => {
      const result = parseNaturalLanguageTask('call John');
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('should give zero confidence for empty input', () => {
      const result = parseNaturalLanguageTask('');
      expect(result.confidence).toBe(0);
    });

    it('should give low confidence for non-task text', () => {
      const result = parseNaturalLanguageTask('the weather is nice');
      expect(result.confidence).toBeLessThan(0.5);
    });
  });

  describe('edge cases', () => {
    it('should handle empty input', () => {
      const result = parseNaturalLanguageTask('');
      expect(result.title).toBe('');
      expect(result.dueDate).toBeNull();
      expect(result.priority).toBe('medium');
      expect(result.confidence).toBe(0);
    });

    it('should handle whitespace-only input', () => {
      const result = parseNaturalLanguageTask('   ');
      expect(result.title).toBe('');
      expect(result.confidence).toBe(0);
    });

    it('should handle input that is only a date', () => {
      const result = parseNaturalLanguageTask('tomorrow');
      expect(result.dueDate).not.toBeNull();
      // Title might be empty after date extraction
      expect(result.parsedFields).toContain('dueDate');
    });

    it('should handle input that is only a priority', () => {
      const result = parseNaturalLanguageTask('urgent');
      expect(result.priority).toBe('urgent');
      expect(result.parsedFields).toContain('priority');
    });

    it('should not crash with special characters', () => {
      const result = parseNaturalLanguageTask('fix bug #123 & deploy $app');
      expect(result.title).toBeTruthy();
    });

    it('should handle very long input', () => {
      const longText = 'fix '.repeat(100) + 'the bug tomorrow high priority';
      const result = parseNaturalLanguageTask(longText);
      expect(result.dueDate).not.toBeNull();
      expect(result.priority).toBe('high');
    });
  });
});
