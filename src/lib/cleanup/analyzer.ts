// src/lib/cleanup/analyzer.ts
import { completeJSON } from '@/lib/ai/client';
import { getTierConfig } from '@/lib/ai/tiers';
import { chunkNote, type Chunk } from './chunker';
import type { CleanupSuggestion, AnalysisResult } from './types';

// Confidence threshold constant
const MIN_CONFIDENCE_THRESHOLD = 0.7;

const CLEANUP_SYSTEM_PROMPT = `You are analyzing a note for cleanup opportunities. Provide structured suggestions.

Analyze for:
1. Structure improvements - better headings, reorganization, clarity
2. Duplicate content - consolidate repetitive points
3. Action items - extract tasks that should be tracked separately
4. Tags/categories - suggest relevant tags based on content

Return JSON array of suggestions. Each suggestion:
{
  "id": "unique-id",
  "type": "structure" | "duplicate" | "task" | "tag",
  "action": "replace" | "insert" | "extract" | "add",
  "target": "section identifier or line range",
  "before": "original text (if replacing)",
  "after": "improved text (if replacing/inserting)",
  "content": "extracted content (for tasks/tags)",
  "reasoning": "why this suggestion helps",
  "confidence": 0.0-1.0
}

Only suggest changes that genuinely improve the note. Be conservative.`;

export async function analyzeNote(
  userId: string,
  content: string
): Promise<AnalysisResult> {
  const chunks = chunkNote(content);
  const config = getTierConfig('fast_llm');

  const allSuggestions: CleanupSuggestion[] = [];

  for (const chunk of chunks) {
    const prompt = buildPrompt(chunk);

    try {
      const suggestions = await completeJSON<CleanupSuggestion[]>(prompt, {
        system: CLEANUP_SYSTEM_PROMPT,
        slot: config.slot,
        userId,
        maxTokens: 1500,
      });

      // Filter by confidence
      const filtered = suggestions.filter(s => s.confidence >= MIN_CONFIDENCE_THRESHOLD);
      allSuggestions.push(...filtered);
    } catch (error) {
      console.error(`Failed to analyze chunk ${chunk.id} for user ${userId}:`, error);
      // Continue with other chunks
    }
  }

  // Deduplicate and limit suggestions
  const deduplicated = deduplicateSuggestions(allSuggestions);
  const limited = limitSuggestions(deduplicated);

  return {
    suggestions: limited,
    chunked: chunks.length > 1,
    chunkCount: chunks.length,
  };
}

function buildPrompt(chunk: Chunk): string {
  let prompt = 'Note content:\n\n';

  if (chunk.precedingContext) {
    prompt += `Context: ${chunk.precedingContext}\n\n`;
  }

  prompt += chunk.content;

  return prompt;
}

function deduplicateSuggestions(suggestions: CleanupSuggestion[]): CleanupSuggestion[] {
  const seen = new Set<string>();
  return suggestions.filter(s => {
    // Normalize target for better deduplication
    const normalizedTarget = s.target.toLowerCase().replace(/^#+\s*/, '').trim();
    const key = `${s.type}-${normalizedTarget}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function limitSuggestions(suggestions: CleanupSuggestion[]): CleanupSuggestion[] {
  const byType: Record<string, CleanupSuggestion[]> = {
    structure: [],
    duplicate: [],
    task: [],
    tag: [],
  };

  suggestions.forEach(s => {
    byType[s.type].push(s);
  });

  // Limit to 10 per type, sorted by confidence
  const limited: CleanupSuggestion[] = [];
  for (const type of Object.keys(byType)) {
    const sorted = byType[type].sort((a, b) => b.confidence - a.confidence);
    limited.push(...sorted.slice(0, 10));
  }

  return limited;
}
