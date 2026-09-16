-- Add retry tracking fields to agent_tasks
-- Run this migration with: npm run db:migrate

-- Add retry_count field (default 0)
ALTER TABLE agent_tasks ADD COLUMN retry_count INTEGER DEFAULT 0;

-- Add max_retries field (default 3)
ALTER TABLE agent_tasks ADD COLUMN max_retries INTEGER DEFAULT 3;

-- Add last_error field to track error messages
ALTER TABLE agent_tasks ADD COLUMN last_error TEXT;

-- Create index for finding stuck tasks faster
CREATE INDEX IF NOT EXISTS idx_agent_tasks_stuck ON agent_tasks(status, updated_at)
  WHERE status = 'processing';
