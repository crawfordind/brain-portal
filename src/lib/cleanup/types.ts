// src/lib/cleanup/types.ts

export interface CleanupSuggestion {
  id: string;
  type: 'structure' | 'duplicate' | 'task' | 'tag';
  action: 'replace' | 'insert' | 'extract' | 'add';
  target: string;
  before?: string;
  after?: string;
  content?: string;
  reasoning: string;
  confidence: number;
  matchConfidence?: number; // Added: fuzzy match confidence
  matchedTarget?: string;   // Added: actual matched string if fuzzy
}

export interface AnalysisResult {
  suggestions: CleanupSuggestion[];
  chunked: boolean;
  chunkCount: number;
}

export interface TaskRecommendationInput {
  source_type: 'note';
  source_id: string;
  source_text: string;
  recommended_task: string;
  reasoning: string;
  confidence: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

export interface ApplyResult {
  updatedContent: string;
  taskRecommendations: TaskRecommendationInput[];
  suggestedTags: string[];
}
