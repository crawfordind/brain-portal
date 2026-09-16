'use client';

import { useMemo } from 'react';
import { useDebounce } from '@/hooks/use-debounce';
import { parseNaturalLanguageTask, type ParsedTask, type ProjectOption } from '@/lib/tasks/nl-parser';

export function useNLTaskParser(
  text: string,
  projects?: ProjectOption[]
): ParsedTask | null {
  const debouncedText = useDebounce(text, 150);

  const parsed = useMemo(() => {
    if (!debouncedText.trim()) return null;
    return parseNaturalLanguageTask(debouncedText, projects);
  }, [debouncedText, projects]);

  return parsed;
}
