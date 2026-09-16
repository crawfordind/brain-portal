"use client";

import { useCallback } from 'react';

export interface PunctuationRule {
  trigger: RegExp;
  replacement: string | ((match: string) => string);
  confidence: number;
  description: string;
}

export interface PunctuationOptions {
  enabled: boolean;
  confidenceThreshold: number;
}

const PUNCTUATION_RULES: PunctuationRule[] = [
  // Question detection - words that typically start questions
  {
    trigger: /^(who|what|where|when|why|how|which|whose|whom|can|could|would|should|will|shall|may|might|is|are|was|were|do|does|did|have|has|had)\s/i,
    replacement: (match) => match,
    confidence: 0.9,
    description: 'Question word detected',
  },

  // Question endings - add question mark at end if starts with question word
  {
    trigger: /(^(?:who|what|where|when|why|how|which|whose|whom|can|could|would|should|will|shall|may|might|is|are|was|were|do|does|did|have|has|had)\s.+)$/i,
    replacement: '$1?',
    confidence: 0.85,
    description: 'Complete question detected',
  },

  // Natural pauses - commas before conjunctions
  {
    trigger: /\s+(and|but|or|yet|so)\s+/gi,
    replacement: ', $1 ',
    confidence: 0.8,
    description: 'Conjunction pause',
  },

  // List items - detect enumeration
  {
    trigger: /^(first|firstly|second|secondly|third|thirdly|next|then|also|additionally|furthermore|moreover|finally|lastly)\s/i,
    replacement: '$1 ',
    confidence: 0.85,
    description: 'List item detected',
  },

  // Sentence capitalization
  {
    trigger: /^([a-z])/,
    replacement: (match) => match.toUpperCase(),
    confidence: 1.0,
    description: 'Capitalize first letter',
  },

  // Period after common sentence endings
  {
    trigger: /(thanks|thank you|okay|ok|got it|sure|yes|no|maybe|perhaps|definitely|absolutely|exactly|correct|right)$/i,
    replacement: '$1.',
    confidence: 0.75,
    description: 'Common sentence ending',
  },

  // Exclamation for emphasis words
  {
    trigger: /(wow|amazing|awesome|fantastic|terrible|horrible|urgent|important|critical|emergency)$/i,
    replacement: '$1!',
    confidence: 0.7,
    description: 'Emphasis detected',
  },

  // Em dash for interruptions
  {
    trigger: /\s+but wait\s+/i,
    replacement: ' — but wait — ',
    confidence: 0.8,
    description: 'Interruption detected',
  },

  // Colon before lists or explanations
  {
    trigger: /\s+(as follows|including|such as|namely|for example|like)\s+/i,
    replacement: ' $1: ',
    confidence: 0.8,
    description: 'List introduction',
  },
];

export function useSmartPunctuation(options: PunctuationOptions = { enabled: true, confidenceThreshold: 0.7 }) {
  const applyPunctuation = useCallback(
    (text: string): string => {
      if (!options.enabled || !text) {
        return text;
      }

      let processed = text;

      // Apply each rule if it meets the confidence threshold
      for (const rule of PUNCTUATION_RULES) {
        if (rule.confidence >= options.confidenceThreshold) {
          if (typeof rule.replacement === 'function') {
            processed = processed.replace(rule.trigger, rule.replacement);
          } else {
            processed = processed.replace(rule.trigger, rule.replacement);
          }
        }
      }

      return processed;
    },
    [options.enabled, options.confidenceThreshold]
  );

  const capitalizeSentences = useCallback((text: string): string => {
    if (!text) return text;

    // Split by sentence-ending punctuation
    const sentences = text.split(/([.!?]\s+)/);

    return sentences
      .map((sentence, index) => {
        // Skip punctuation parts
        if (sentence.match(/^[.!?]\s+$/)) {
          return sentence;
        }

        // Capitalize first letter of each sentence
        return sentence.charAt(0).toUpperCase() + sentence.slice(1);
      })
      .join('');
  }, []);

  const addPeriodIfNeeded = useCallback((text: string): string => {
    if (!text) return text;

    // Check if text already ends with punctuation
    if (text.match(/[.!?]$/)) {
      return text;
    }

    // Add period if text is long enough (likely a complete thought)
    if (text.split(/\s+/).length >= 3) {
      return text + '.';
    }

    return text;
  }, []);

  const detectQuestionAndAddMark = useCallback((text: string): string => {
    if (!text) return text;

    // Already has question mark
    if (text.endsWith('?')) {
      return text;
    }

    // Check for question words at the start
    const questionWords = /^(who|what|where|when|why|how|which|whose|whom|can|could|would|should|will|shall|may|might|is|are|was|were|do|does|did|have|has|had)\s/i;

    if (questionWords.test(text)) {
      return text + '?';
    }

    return text;
  }, []);

  const formatListItem = useCallback((text: string): string => {
    if (!text) return text;

    // Detect list indicators
    const listIndicators = /^(first|firstly|second|secondly|third|thirdly|next|then|also|additionally|furthermore|moreover|finally|lastly)\s/i;

    if (listIndicators.test(text)) {
      return '- ' + text;
    }

    return text;
  }, []);

  const processVoiceTranscript = useCallback(
    (text: string, isComplete: boolean = false): string => {
      if (!text || !options.enabled) {
        return text;
      }

      let processed = text.trim();

      // Apply all punctuation rules
      processed = applyPunctuation(processed);

      // Detect and mark questions
      processed = detectQuestionAndAddMark(processed);

      // Capitalize sentences
      processed = capitalizeSentences(processed);

      // Add period if this is the final transcript
      if (isComplete) {
        processed = addPeriodIfNeeded(processed);
      }

      return processed;
    },
    [
      options.enabled,
      applyPunctuation,
      detectQuestionAndAddMark,
      capitalizeSentences,
      addPeriodIfNeeded,
    ]
  );

  const getRules = useCallback(() => PUNCTUATION_RULES, []);

  return {
    applyPunctuation,
    capitalizeSentences,
    addPeriodIfNeeded,
    detectQuestionAndAddMark,
    formatListItem,
    processVoiceTranscript,
    getRules,
  };
}
