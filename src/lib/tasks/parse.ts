import { completeJSON } from '@/lib/ai/client';
import { getModelForSlot } from '@/lib/ai/models';
import { db, queryOne } from '@/lib/db/client';
import { createHash } from 'crypto';
import { validateDueDate } from './date-utils';

export interface ParsedTask {
  title: string;
  dueDate: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent' | null;
  agent: string | null;
  tags: string[];
}

export async function parseTaskNL(
  content: string,
  today: string,
  userId: string
): Promise<ParsedTask | null> {
  const contentHash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  const cacheKey = `parse:${userId}:${contentHash}`;

  // Check cache
  try {
    const cached = await queryOne<{ output: string }>(
      "SELECT output FROM ai_cache WHERE cache_key = ? AND (expires_at IS NULL OR expires_at > datetime('now'))",
      [cacheKey]
    );
    if (cached) {
      return JSON.parse(cached.output) as ParsedTask;
    }
  } catch {
    // Cache miss or error — proceed to LLM
  }

  // Call LLM
  try {
    const prompt = `Today is ${today}. Parse this task description and return JSON only:
{
  "title": "cleaned task title without date/priority/agent keywords",
  "dueDate": "YYYY-MM-DD or null",
  "priority": "low|medium|high|urgent or null",
  "agent": "code|copy|research|marketing|analyst|general or null",
  "tags": []
}
Task: "${content.replace(/"/g, "'")}"`;

    const parsed = await completeJSON<ParsedTask>(prompt, {
      slot: "fast",
      userId,
      maxTokens: 256,
    });

    if (!parsed || typeof parsed.title !== 'string') return null;

    // Normalize. Bound-check the due date against "today" so the model can't
    // hallucinate (or lift from body text) a date in the past or far future.
    const result: ParsedTask = {
      title: parsed.title || content,
      dueDate: validateDueDate(parsed.dueDate, today),
      priority: parsed.priority || null,
      agent: parsed.agent || null,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };

    // Save to cache (24h TTL)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    await db.execute({
      sql: `INSERT OR REPLACE INTO ai_cache
        (user_id, cache_key, operation_type, tier, model, input_hash, output, expires_at)
        VALUES (?, ?, 'task_parse', 'fast_llm', ?, ?, ?, ?)`,
      args: [userId, cacheKey, await getModelForSlot('fast', userId), contentHash, JSON.stringify(result), expiresAt],
    });

    return result;
  } catch {
    return null;
  }
}
