import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncTaskStatusFromAgentTask } from '@/lib/agents/status-sync';
import { db, queryOne } from '@/lib/db/client';

// Mock dependencies
vi.mock('@/lib/db/client', async () => ({
  ...(await import('../../helpers/db-mock')).createDbClientMock(),
}));

describe('Task-Agent Task Status Sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // syncTaskStatusFromAgentTask looks the agent_task up first and returns
    // early when it finds nothing, so every case needs a row to act on.
    vi.mocked(queryOne).mockResolvedValue({
      source_type: 'task',
      task_id: 'task-1',
    } as never);
  });

  it('does nothing when the agent task does not exist', async () => {
    vi.mocked(queryOne).mockResolvedValue(null);

    await syncTaskStatusFromAgentTask('missing', 'queued');

    expect(db.execute).not.toHaveBeenCalled();
  });

  it('should sync task to in_progress when agent task is queued', async () => {
    await syncTaskStatusFromAgentTask('agent-task-123', 'queued');

    expect(db.execute).toHaveBeenCalledWith({
      sql: expect.stringContaining('UPDATE tasks'),
      args: ['in_progress', 'agent-task-123'],
    });
  });

  it('should sync task to in_progress when agent task is processing', async () => {
    await syncTaskStatusFromAgentTask('agent-task-123', 'processing');

    expect(db.execute).toHaveBeenCalledWith({
      sql: expect.stringContaining('UPDATE tasks'),
      args: ['in_progress', 'agent-task-123'],
    });
  });

  it('should sync task to in_progress when agent task is awaiting_review', async () => {
    await syncTaskStatusFromAgentTask('agent-task-123', 'awaiting_review');

    expect(db.execute).toHaveBeenCalledWith({
      sql: expect.stringContaining('UPDATE tasks'),
      args: ['in_progress', 'agent-task-123'],
    });
  });

  it('should sync task to completed when agent task is approved', async () => {
    await syncTaskStatusFromAgentTask('agent-task-123', 'approved');

    expect(db.execute).toHaveBeenCalledWith({
      sql: expect.stringContaining('UPDATE tasks'),
      args: ['completed', 'agent-task-123'],
    });
  });

  it('should sync task to pending when agent task is rejected', async () => {
    await syncTaskStatusFromAgentTask('agent-task-123', 'rejected');

    expect(db.execute).toHaveBeenCalledWith({
      sql: expect.stringContaining('UPDATE tasks'),
      args: ['pending', 'agent-task-123'],
    });
  });

  it('should sync task to pending when agent task is failed', async () => {
    await syncTaskStatusFromAgentTask('agent-task-123', 'failed');

    expect(db.execute).toHaveBeenCalledWith({
      sql: expect.stringContaining('UPDATE tasks'),
      args: ['pending', 'agent-task-123'],
    });
  });

  it('should sync task to in_progress when agent task is revision_requested', async () => {
    await syncTaskStatusFromAgentTask('agent-task-123', 'revision_requested');

    expect(db.execute).toHaveBeenCalledWith({
      sql: expect.stringContaining('UPDATE tasks'),
      args: ['in_progress', 'agent-task-123'],
    });
  });

  it('should handle unknown status by defaulting to in_progress', async () => {
    await syncTaskStatusFromAgentTask('agent-task-123', 'unknown_status');

    expect(db.execute).toHaveBeenCalledWith({
      sql: expect.stringContaining('UPDATE tasks'),
      args: ['in_progress', 'agent-task-123'],
    });
  });

  it('should update the updated_at timestamp', async () => {
    await syncTaskStatusFromAgentTask('agent-task-123', 'approved');

    expect(db.execute).toHaveBeenCalledWith({
      sql: expect.stringContaining("updated_at = datetime('now')"),
      args: expect.any(Array),
    });
  });

  it('should use agent_task_id to find the correct task', async () => {
    await syncTaskStatusFromAgentTask('agent-task-456', 'approved');

    expect(db.execute).toHaveBeenCalledWith({
      sql: expect.stringContaining('WHERE agent_task_id = ?'),
      args: ['completed', 'agent-task-456'],
    });
  });
});
