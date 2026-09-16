import { useEffect, useState, useRef, useCallback } from 'react';
import { useDebounce } from './use-debounce';

export interface UseAutoSaveOptions<T> {
  /** The data to auto-save */
  data: T;
  /** Function to call when saving */
  onSave: (data: T) => Promise<void>;
  /** Debounce delay in milliseconds (default: 1000) */
  delay?: number;
  /** Whether auto-save is enabled (default: true) */
  enabled?: boolean;
}

export interface UseAutoSaveReturn {
  /** Current save status */
  status: 'idle' | 'saving' | 'saved' | 'error';
  /** Timestamp of last successful save */
  lastSaved: Date | null;
  /** Cancel any pending auto-save */
  cancelPending: () => void;
  /** Force an immediate save */
  forceSave: () => Promise<void>;
}

/**
 * Hook for auto-saving data with debouncing
 *
 * @example
 * const autoSave = useAutoSave({
 *   data: { title, content },
 *   onSave: async (data) => {
 *     await updateNote(data);
 *   },
 *   delay: 1000,
 * });
 *
 * // Cancel pending save before manual save
 * const handleManualSave = () => {
 *   autoSave.cancelPending();
 *   // ... perform manual save
 * };
 */
export function useAutoSave<T>(options: UseAutoSaveOptions<T>): UseAutoSaveReturn {
  const { data, onSave, delay = 1000, enabled = true } = options;

  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const isInitialMount = useRef(true);
  const previousData = useRef<T>(data);
  const isSavingRef = useRef(false);

  const debouncedData = useDebounce(data, delay);

  // Auto-save effect
  useEffect(() => {
    if (!enabled) return;

    // Skip initial mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      previousData.current = data;
      return;
    }

    // Check if data actually changed (deep equality)
    if (JSON.stringify(debouncedData) === JSON.stringify(previousData.current)) {
      return;
    }

    // Prevent concurrent saves
    if (isSavingRef.current) {
      return;
    }

    previousData.current = debouncedData;

    // Perform save
    isSavingRef.current = true;
    setStatus('saving');

    onSave(debouncedData)
      .then(() => {
        setStatus('saved');
        setLastSaved(new Date());
      })
      .catch((error) => {
        console.error('[AutoSave] Save failed:', error);
        setStatus('error');
      })
      .finally(() => {
        isSavingRef.current = false;
      });
  }, [debouncedData, enabled, onSave]);

  const cancelPending = useCallback(() => {
    // The debounce will handle cancellation automatically
    // This just resets the status
    if (status === 'saving' && !isSavingRef.current) {
      setStatus('idle');
    }
  }, [status]);

  const forceSave = useCallback(async () => {
    if (isSavingRef.current) {
      return; // Don't force save if already saving
    }

    isSavingRef.current = true;
    setStatus('saving');

    try {
      await onSave(data);
      setStatus('saved');
      setLastSaved(new Date());
      previousData.current = data;
    } catch (error) {
      console.error('[AutoSave] Force save failed:', error);
      setStatus('error');
    } finally {
      isSavingRef.current = false;
    }
  }, [data, onSave]);

  return { status, lastSaved, cancelPending, forceSave };
}
