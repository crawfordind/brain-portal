import { describe, it, expect } from 'vitest';
import { extractCandidates, hasActionIndicators, hasTimeLanguage, countWords } from '@/lib/recommendations/utils';

describe('extractCandidates', () => {
  it('should split content into sentences', () => {
    const content = 'First sentence. Second sentence! Third sentence?';
    const candidates = extractCandidates(content);

    expect(candidates).toHaveLength(3);
    expect(candidates[0].text).toBe('First sentence');
    expect(candidates[1].text).toBe('Second sentence');
  });

  it('should include context from surrounding sentences', () => {
    const content = 'Before. Target sentence here. After.';
    const candidates = extractCandidates(content);

    const targetCandidate = candidates.find(c => c.text === 'Target sentence here');
    expect(targetCandidate?.context).toContain('Before');
    expect(targetCandidate?.context).toContain('After');
  });

  it('should filter out very short sentences', () => {
    const content = 'Hi. This is a longer sentence that should be included.';
    const candidates = extractCandidates(content);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].text).toBe('This is a longer sentence that should be included');
  });
});

describe('hasActionIndicators', () => {
  it('should detect action verbs', () => {
    expect(hasActionIndicators('need to review the budget')).toBe(true);
    expect(hasActionIndicators('should contact Sarah')).toBe(true);
    expect(hasActionIndicators('must fix the bug')).toBe(true);
  });

  it('should reject non-actionable text', () => {
    expect(hasActionIndicators('thinking about the project')).toBe(false);
    expect(hasActionIndicators('the meeting was good')).toBe(false);
  });
});

describe('hasTimeLanguage', () => {
  it('should detect time-based language', () => {
    expect(hasTimeLanguage('I need to do this today')).toBe(true);
    expect(hasTimeLanguage('deadline is next week')).toBe(true);
    expect(hasTimeLanguage('by friday we should complete')).toBe(true);
  });

  it('should reject text without time language', () => {
    expect(hasTimeLanguage('generic task description')).toBe(false);
    expect(hasTimeLanguage('review the document')).toBe(false);
  });
});

describe('countWords', () => {
  it('should count words correctly', () => {
    expect(countWords('Hello world')).toBe(2);
    expect(countWords('One two three four five')).toBe(5);
    expect(countWords('  spaced   out   words  ')).toBe(3);
  });

  it('should handle empty strings', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });
});
