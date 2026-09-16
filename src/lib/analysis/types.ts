// src/lib/analysis/types.ts

/**
 * Note Analysis Types
 * Deep analysis of note content: extracts structure, links, key entities,
 * and generates executive summaries, research briefs, and action items.
 */

export type AnalysisSectionType =
  | 'executive_summary'
  | 'key_findings'
  | 'deep_research'
  | 'entities'
  | 'questions'
  | 'action_items';

export interface ExtractedLink {
  url: string;
  title: string;
  context: string; // surrounding sentence
  type: 'external' | 'internal' | 'wikilink';
}

export interface ExtractedEntity {
  name: string;
  type: 'person' | 'organization' | 'place' | 'concept' | 'technology' | 'date' | 'metric';
  mentions: number;
  context: string;
}

export interface KeyFinding {
  id: string;
  insight: string;
  evidence: string; // quote or reference from note
  importance: 'high' | 'medium' | 'low';
}

export interface ResearchThread {
  id: string;
  topic: string;
  summary: string;
  depth: 'surface' | 'moderate' | 'deep';
  relatedConcepts: string[];
  suggestedQueries: string[];
}

export interface ActionItem {
  id: string;
  action: string;
  priority: 'high' | 'medium' | 'low';
  category: 'follow_up' | 'research' | 'create' | 'review' | 'decide' | 'communicate';
  reasoning: string;
}

export interface OpenQuestion {
  id: string;
  question: string;
  context: string;
  type: 'clarification' | 'exploration' | 'decision' | 'validation';
}

export interface NoteAnalysisResult {
  // Metadata
  noteId: string;
  analyzedAt: string;
  wordCount: number;
  readTime: number; // minutes
  complexity: 'simple' | 'moderate' | 'complex' | 'dense';

  // Extraction (local/free)
  links: ExtractedLink[];
  entities: ExtractedEntity[];
  topics: string[];

  // AI-generated sections
  executiveSummary: string;
  keyFindings: KeyFinding[];
  researchThreads: ResearchThread[];
  actionItems: ActionItem[];
  openQuestions: OpenQuestion[];

  // Connections
  relatedNoteIds: Array<{ id: string; title: string; similarity: number }>;
}
