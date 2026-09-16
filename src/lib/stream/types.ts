/**
 * Stream Types - The unified data model for the agentic workflow
 *
 * Everything in the system is a "Stream Item" - the atomic unit of thought.
 * The AI classifies and routes each item automatically.
 */

export type StreamItemType =
  | "thought"      // Quick thought, random idea
  | "task"         // Something to do (personal or delegated)
  | "note"         // Extended writing, knowledge
  | "journal"      // Personal activity log entry (daily journal)
  | "question"     // Something to research/answer
  | "decision"     // A decision point that needs resolution
  | "reference"    // Link, quote, external content
  | "insight"      // AI-generated connection or pattern
  | "agent_output" // Output from an AI agent
  | "reminder"     // Time-based trigger
  | "capture";     // Raw unclassified input

export type StreamItemStatus =
  | "active"       // Live, current
  | "processing"   // AI is working on it
  | "waiting"      // Waiting for user action (review, decision)
  | "completed"    // Done
  | "archived";    // Out of sight, still searchable

export type AgentType = "code" | "copy" | "research" | "marketing" | "analyst" | "general" | "ux";

export interface StreamItemAction {
  type: "delegate" | "expand" | "connect" | "remind" | "convert" | "archive" | "complete";
  label: string;
  agentType?: AgentType;
  targetType?: StreamItemType;
  scheduledAt?: string;
}

/**
 * The AI classification result for any raw input
 */
export interface IntentClassification {
  /** Primary type the AI detected */
  type: StreamItemType;
  /** Confidence 0-1 */
  confidence: number;
  /** Extracted title/summary */
  title: string;
  /** Cleaned/expanded content */
  content: string;
  /** Suggested priority */
  priority: "low" | "medium" | "high" | "urgent";
  /** Extracted due date (if task-like) */
  dueDate?: string;
  /** Suggested project match */
  projectSlug?: string;
  /** Suggested tags */
  tags: string[];
  /** Suggested next actions the user might want */
  suggestedActions: StreamItemAction[];
  /** If the AI thinks this should be delegated, which agent */
  suggestedAgent?: AgentType;
  /** Reasoning for the classification (short) */
  reasoning: string;
}

/**
 * A Stream Item as stored and displayed
 */
export interface StreamItem {
  id: string;
  userId: string;
  type: StreamItemType;
  status: StreamItemStatus;
  title: string;
  content: string;
  rawInput: string;
  priority: "low" | "medium" | "high" | "urgent";
  projectId?: string;
  projectName?: string;
  projectColor?: string;
  tags: string[];
  dueDate?: string;
  // Agent delegation
  delegatedTo?: AgentType;
  agentTaskId?: string;
  agentOutput?: string;
  agentStatus?: string;
  // Connections
  linkedItemIds: string[];
  parentItemId?: string;
  // Source tracking
  sourceType: "manual" | "voice" | "import" | "ai_generated" | "agent_output";
  sourceEntityId?: string;
  sourceEntityType?: string;
  // Classification metadata
  classification?: IntentClassification;
  // Timestamps
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  scheduledAt?: string;
}

/**
 * The Brain Bar input state
 */
export interface BrainBarState {
  input: string;
  isClassifying: boolean;
  classification: IntentClassification | null;
  isExpanded: boolean;
  selectedAgent: AgentType | null;
  linkedNoteIds: string[];
}

/**
 * Stream filter state
 */
export interface StreamFilter {
  types: StreamItemType[];
  statuses: StreamItemStatus[];
  projectId?: string;
  agentType?: AgentType;
  dateRange?: { from: string; to: string };
  searchQuery?: string;
}
