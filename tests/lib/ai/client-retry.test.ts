import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: (...args: unknown[]) => mockCreate(...args) } };
  },
}));

import { completeWithMeta } from '@/lib/ai/client';

function okResponse(content: string, finishReason = 'stop') {
  return {
    model: 'test-model',
    choices: [{ message: { content }, finish_reason: finishReason }],
  };
}

function httpError(status: number) {
  const err = new Error(`HTTP ${status}`) as Error & { status: number };
  err.status = status;
  return err;
}

describe('completeWithMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces the finish reason alongside the content', async () => {
    mockCreate.mockResolvedValueOnce(okResponse('hello', 'length'));

    const result = await completeWithMeta('prompt');

    expect(result).toEqual({ content: 'hello', finishReason: 'length', model: 'test-model' });
  });

  it('retries transient upstream failures and succeeds', async () => {
    mockCreate
      .mockRejectedValueOnce(httpError(429))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce(okResponse('recovered'));

    const result = await completeWithMeta('prompt', { retries: 2, retryDelayMs: 1 });

    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(result.content).toBe('recovered');
  });

  it('does not retry non-transient failures', async () => {
    mockCreate.mockRejectedValue(httpError(400));

    await expect(completeWithMeta('prompt', { retries: 3, retryDelayMs: 1 })).rejects.toThrow(
      'HTTP 400'
    );
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting the retry budget', async () => {
    mockCreate.mockRejectedValue(httpError(502));

    await expect(completeWithMeta('prompt', { retries: 2, retryDelayMs: 1 })).rejects.toThrow(
      'HTTP 502'
    );
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('throws on an HTTP-200 error envelope instead of returning empty content', async () => {
    // OpenRouter answers 200 with an error body when an upstream provider
    // rejects the request; without this the caller silently gets "".
    mockCreate.mockResolvedValueOnce({ error: { message: 'provider unavailable', code: 502 } });

    await expect(completeWithMeta('prompt')).rejects.toThrow(/provider unavailable/);
  });

  it('returns empty content rather than throwing when the model simply says nothing', async () => {
    mockCreate.mockResolvedValueOnce(okResponse('', 'length'));

    const result = await completeWithMeta('prompt');

    expect(result.content).toBe('');
    expect(result.finishReason).toBe('length');
  });
});
