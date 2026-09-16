// src/lib/analysis/analyzer.ts

/**
 * Note Analysis Engine
 * Combines free local extraction with AI-powered deep analysis.
 * Uses tiered processing: local (free) → fast_llm → full_llm
 */

import { completeJSON } from '@/lib/ai/client';
import { getTierConfig } from '@/lib/ai/tiers';
import { extractLinks, analyzeStructure, stripMarkdown } from '@/lib/processing/local';
import { findSimilarNotes } from '@/lib/ai/embeddings';
import { buildAnnotationPromptSection } from '@/lib/annotations';
import type {
  NoteAnalysisResult,
  ExtractedLink,
  ExtractedEntity,
  KeyFinding,
  ResearchThread,
  ActionItem,
  OpenQuestion,
} from './types';

const ANALYSIS_SYSTEM_PROMPT = `You are a research analyst delivering a briefing on a single note. Your consumer is busy — maximum signal, zero noise.

Return a single JSON object with this exact structure:

{
  "executiveSummary": "2-4 sentences: core point, significance, and implication. Never open with 'This note discusses...'",
  "topics": ["topic1", "topic2"],
  "entities": [
    {
      "name": "Entity Name",
      "type": "person|organization|place|concept|technology|date|metric",
      "mentions": 1,
      "context": "How this entity is relevant, not just that it appears"
    }
  ],
  "keyFindings": [
    {
      "id": "kf-1",
      "insight": "What the note implies that it doesn't explicitly state — one sharp sentence",
      "evidence": "Direct quote or specific reference from the note",
      "importance": "high|medium|low"
    }
  ],
  "researchThreads": [
    {
      "id": "rt-1",
      "topic": "Research topic title",
      "summary": "Why this thread is worth pursuing and what it could unlock",
      "depth": "surface|moderate|deep",
      "relatedConcepts": ["concept1", "concept2"],
      "suggestedQueries": ["Specific searchable query 1", "Specific searchable query 2"]
    }
  ],
  "actionItems": [
    {
      "id": "ai-1",
      "action": "Verb-first, specific enough to act on without re-reading the note",
      "priority": "high|medium|low",
      "category": "follow_up|research|create|review|decide|communicate",
      "reasoning": "Why this action matters now"
    }
  ],
  "openQuestions": [
    {
      "id": "oq-1",
      "question": "A genuine uncertainty or unstated assumption — not a question the note already answers",
      "context": "What's at stake if this question goes unanswered",
      "type": "clarification|exploration|decision|validation"
    }
  ]
}

Rules:
- Key findings: Extract what's non-obvious. If it's stated directly in the note, it's not a finding.
- Action items: "Email Sarah about the Q4 concern in section 3" not "Follow up." Specific or skip it.
- Open questions: Surface gaps and unstated assumptions — not comprehension questions.
- Entities: Significant ones only. Skip generic nouns.
- Topics: 3-7 tags. How would you search for this note later?
- Empty arrays are correct when a category has nothing qualifying. Do not pad.`;

/**
 * Determine note complexity based on structure analysis
 */
function assessComplexity(
  wordCount: number,
  headingCount: number,
  linkCount: number,
  codeBlockCount: number
): 'simple' | 'moderate' | 'complex' | 'dense' {
  const score =
    (wordCount > 1000 ? 2 : wordCount > 500 ? 1 : 0) +
    (headingCount > 5 ? 2 : headingCount > 2 ? 1 : 0) +
    (linkCount > 10 ? 2 : linkCount > 3 ? 1 : 0) +
    (codeBlockCount > 3 ? 1 : 0);

  if (score >= 5) return 'dense';
  if (score >= 3) return 'complex';
  if (score >= 1) return 'moderate';
  return 'simple';
}

/**
 * Transform raw extracted links into analysis-friendly format
 */
function transformLinks(
  rawLinks: ReturnType<typeof extractLinks>,
  content: string
): ExtractedLink[] {
  return rawLinks.map((link) => {
    // Extract surrounding sentence for context
    const start = Math.max(0, link.position.start - 80);
    const end = Math.min(content.length, link.position.end + 80);
    const context = content.slice(start, end).replace(/\n/g, ' ').trim();

    return {
      url: link.target,
      title: link.text,
      context,
      type: link.type,
    };
  });
}

/**
 * Analyze a note — combines local extraction + AI deep analysis
 */
export async function analyzeNoteContent(
  userId: string,
  noteId: string,
  noteTitle: string,
  noteContent: string
): Promise<NoteAnalysisResult> {
  // Phase 1: Local extraction (free)
  const structure = analyzeStructure(noteContent);
  const rawLinks = extractLinks(noteContent);
  const links = transformLinks(rawLinks, noteContent);
  const plainText = stripMarkdown(noteContent);

  const complexity = assessComplexity(
    structure.wordCount,
    structure.headings.length,
    rawLinks.length,
    structure.codeBlocks.length
  );

  // Phase 2: AI-powered deep analysis (full_llm tier for quality)
  const config = getTierConfig('full_llm');

  // The user's semantic highlights, read from the raw HTML — `plainText` has
  // had the markup stripped out of it, which is exactly where they live.
  const annotationSection = buildAnnotationPromptSection(noteContent);

  // Build prompt with note content
  const contentForAnalysis = plainText.substring(0, 6000); // Cap at ~1500 tokens
  const prompt = `Analyze this note thoroughly:

Title: ${noteTitle}

Content:
${contentForAnalysis}

${rawLinks.length > 0 ? `\nLinks found: ${rawLinks.map((l) => l.target).join(', ')}` : ''}
${structure.headings.length > 0 ? `\nStructure: ${structure.headings.map((h) => `${'#'.repeat(h.level)} ${h.text}`).join(', ')}` : ''}
${structure.taskItems.length > 0 ? `\nExisting tasks: ${structure.taskItems.map((t) => `[${t.checked ? 'x' : ' '}] ${t.text}`).join(', ')}` : ''}

Word count: ${structure.wordCount}
Sections: ${structure.headings.length}
Has code: ${structure.codeBlocks.length > 0}
Has images: ${structure.hasImages}
${annotationSection ? `\n${annotationSection}\n\nLet these markings steer the analysis: a passage the user questioned belongs in the open questions, one they asked you to verify belongs in the key findings with its confidence stated, and one they asked to expand or cut belongs in the action items.` : ''}`;

  interface AIAnalysis {
    executiveSummary: string;
    topics: string[];
    entities: ExtractedEntity[];
    keyFindings: KeyFinding[];
    researchThreads: ResearchThread[];
    actionItems: ActionItem[];
    openQuestions: OpenQuestion[];
  }

  const aiResult = await completeJSON<AIAnalysis>(prompt, {
    system: ANALYSIS_SYSTEM_PROMPT,
    slot: config.slot,
    userId,
    maxTokens: 3000,
  });

  // Phase 3: Find related notes via embeddings
  let relatedNoteIds: Array<{ id: string; title: string; similarity: number }> = [];
  try {
    const similar = await findSimilarNotes(userId, noteId, 0.6, 5);
    relatedNoteIds = similar
      .filter((n) => n.id !== noteId) // Exclude self
      .map((n) => ({
        id: n.id,
        title: n.title,
        similarity: n.similarity,
      }));
  } catch (error) {
    console.error('Error finding related notes for analysis:', error);
  }

  return {
    noteId,
    analyzedAt: new Date().toISOString(),
    wordCount: structure.wordCount,
    readTime: structure.estimatedReadTime,
    complexity,

    links,
    entities: aiResult.entities || [],
    topics: aiResult.topics || [],

    executiveSummary: aiResult.executiveSummary || '',
    keyFindings: aiResult.keyFindings || [],
    researchThreads: aiResult.researchThreads || [],
    actionItems: aiResult.actionItems || [],
    openQuestions: aiResult.openQuestions || [],

    relatedNoteIds,
  };
}
