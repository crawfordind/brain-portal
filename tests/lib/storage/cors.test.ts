import { describe, it, expect } from 'vitest';
import { buildUploadCorsRule, normalizeOrigins } from '@/lib/storage/cors';

describe('upload CORS rule', () => {
  it('reduces addresses to bare origins, once each', () => {
    expect(
      normalizeOrigins(['https://app.example.com/notes', 'https://app.example.com', 'not a url', ' '])
    ).toEqual(['https://app.example.com']);
  });

  it('allows PUT with a Content-Type from the app', () => {
    const rule = buildUploadCorsRule(['https://app.example.com', 'http://localhost:3000']);
    expect(rule.AllowedOrigins).toEqual(['https://app.example.com', 'http://localhost:3000']);
    expect(rule.AllowedMethods).toContain('PUT');
    expect(rule.AllowedHeaders).toEqual(['content-type']);
  });

  it('refuses to write a rule with no origin', () => {
    expect(() => buildUploadCorsRule([])).toThrow(/No valid origin/);
  });
});
