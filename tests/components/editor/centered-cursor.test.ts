import { describe, it, expect } from 'vitest';
import { CenteredCursor } from '@/components/editor/extensions/centered-cursor';

describe('CenteredCursor', () => {
  it('should create extension with correct name', () => {
    expect(CenteredCursor.name).toBe('centeredCursor');
  });

  it('should be defined', () => {
    expect(CenteredCursor).toBeDefined();
  });
});
