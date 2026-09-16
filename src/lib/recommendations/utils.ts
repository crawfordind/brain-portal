/**
 * Utility functions for task recommendation system
 */

export interface Candidate {
  text: string;
  context: string;
}

/**
 * Extract candidate sentences from content
 */
export function extractCandidates(content: string): Candidate[] {
  // Split by sentences (., !, ?)
  const allSentences = content
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const candidates: Candidate[] = [];

  for (let i = 0; i < allSentences.length; i++) {
    const sentence = allSentences[i];

    // Only create candidates for sentences longer than 10 characters
    if (sentence.length <= 10) {
      continue;
    }

    // Create context window (1 before, 1 after) from all sentences
    const contextStart = Math.max(0, i - 1);
    const contextEnd = Math.min(allSentences.length, i + 2);
    const context = allSentences.slice(contextStart, contextEnd).join('. ');

    candidates.push({
      text: sentence,
      context: context
    });
  }

  return candidates;
}

/**
 * Check if text contains action indicators (verbs, time language)
 */
export function hasActionIndicators(text: string): boolean {
  const actionVerbs = [
    'need to', 'should', 'must', 'have to', 'going to',
    'review', 'check', 'contact', 'reach out', 'send', 'email',
    'create', 'build', 'fix', 'update', 'finish', 'complete',
    'schedule', 'plan', 'prepare', 'research', 'investigate'
  ];

  const lowerText = text.toLowerCase();
  return actionVerbs.some(verb => lowerText.includes(verb));
}

/**
 * Detect time-based language in text
 */
export function hasTimeLanguage(text: string): boolean {
  const timeWords = [
    'today', 'tomorrow', 'this week', 'next week', 'monday', 'tuesday',
    'wednesday', 'thursday', 'friday', 'by friday', 'before', 'deadline',
    'due', 'asap', 'urgent'
  ];

  const lowerText = text.toLowerCase();
  return timeWords.some(word => lowerText.includes(word));
}

/**
 * Count words in text
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}
