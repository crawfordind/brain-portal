import Dexie, { Table } from "dexie";

// Sync status for local records
export type SyncStatus = "synced" | "pending" | "error";

// Base interface for sync metadata
interface SyncMeta {
  _syncStatus: SyncStatus;
  _lastModified: number; // Unix timestamp for conflict resolution
  _tempId?: string; // Temporary ID for records created offline
}

// Offline versions of server entities (matching schema.ts types + sync metadata)
export interface OfflineNote extends SyncMeta {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  slug: string;
  content: string;
  content_plain: string | null;
  note_type: "note" | "daily" | "weekly" | "insight";
  is_pinned: boolean;
  is_archived: boolean;
  word_count: number;
  frontmatter: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface OfflineCapture extends SyncMeta {
  id: string;
  user_id: string;
  daily_note_id: string | null;
  content: string;
  capture_type: "thought" | "idea" | "followup" | "task" | "quote" | "reference";
  captured_at: string;
  processed: boolean;
  linked_notes: string;
  linked_projects: string;
  tags: string;
  metadata: string;
  created_at: string;
}

export interface OfflineTask extends SyncMeta {
  id: string;
  user_id: string;
  note_id: string | null;
  project_id: string | null;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  due_date: string | null;
  completed_at: string | null;
  position: number;
  tags: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface OfflineProject extends SyncMeta {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: "active" | "planning" | "stalled" | "completed" | "archived";
  color: string;
  icon: string;
  priority: number;
  parent_id: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface OfflineDailyNote extends SyncMeta {
  id: string;
  note_id: string;
  user_id: string;
  date: string;
  morning_focus: string | null;
  reflection: string;
  mood: number | null;
  energy: number | null;
  created_at: string;
  updated_at: string;
}

export interface OfflineTag extends SyncMeta {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  color: string;
  usage_count: number;
  created_at: string;
}

// Sync queue for pending operations
export interface SyncQueueItem {
  id?: number; // Auto-increment
  entityType: EntityType;
  entityId: string;
  operation: SyncOperation;
  payload: Record<string, unknown>;
  timestamp: number;
  retryCount: number;
  lastError?: string;
  status: "pending" | "processing" | "failed";
}

// Sync metadata for tracking last sync times
export interface SyncMetadata {
  id: string; // 'global'
  lastFullSync: number | null;
  lastIncrementalSync: number | null;
  syncInProgress: boolean;
}

export type EntityType = "note" | "capture" | "task" | "project" | "dailyNote" | "tag";
export type SyncOperation = "create" | "update" | "delete";

// Dexie database class
export class BrainPortalDB extends Dexie {
  notes!: Table<OfflineNote, string>;
  captures!: Table<OfflineCapture, string>;
  tasks!: Table<OfflineTask, string>;
  projects!: Table<OfflineProject, string>;
  dailyNotes!: Table<OfflineDailyNote, string>;
  tags!: Table<OfflineTag, string>;
  syncQueue!: Table<SyncQueueItem, number>;
  syncMetadata!: Table<SyncMetadata, string>;

  constructor() {
    super("BrainPortalDB");

    this.version(1).stores({
      // Primary key is 'id', indexed fields for querying
      notes: "id, user_id, project_id, slug, note_type, is_pinned, is_archived, updated_at, _syncStatus",
      captures: "id, user_id, daily_note_id, capture_type, captured_at, processed, _syncStatus",
      tasks: "id, user_id, project_id, note_id, status, priority, due_date, _syncStatus",
      projects: "id, user_id, slug, status, parent_id, _syncStatus",
      dailyNotes: "id, user_id, note_id, date, _syncStatus",
      tags: "id, user_id, slug, _syncStatus",
      // Sync queue with auto-increment id
      syncQueue: "++id, entityType, entityId, status, timestamp",
      // Sync metadata (single record)
      syncMetadata: "id",
    });
  }
}

// Singleton database instance
export const offlineDb = new BrainPortalDB();

// Helper to check if an ID is a temporary offline ID
export function isTempId(id: string): boolean {
  return id.startsWith("temp_");
}

// Helper to generate a temporary ID
export function generateTempId(): string {
  return `temp_${crypto.randomUUID()}`;
}

// Helper to get current timestamp
export function now(): number {
  return Date.now();
}

// Helper to get current ISO timestamp
export function nowISO(): string {
  return new Date().toISOString();
}
