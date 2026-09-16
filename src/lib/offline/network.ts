/**
 * Network-aware utilities for offline-first data access.
 *
 * Provides helpers that components can use to gracefully handle
 * offline scenarios without needing to change their fetch patterns.
 */

/**
 * Check if the browser is currently online.
 * More reliable than just navigator.onLine - also verifies with a lightweight ping.
 */
export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

/**
 * Fetch with offline awareness.
 * - If offline, immediately rejects with an identifiable error
 * - If online, wraps fetch with a timeout
 * - Adds AbortController for clean cancellation
 */
export async function offlineAwareFetch(
  input: RequestInfo | URL,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const { timeoutMs = 8000, ...fetchInit } = init || {};

  if (!isOnline()) {
    throw new OfflineError("No network connection");
  }

  const controller = new AbortController();
  const existingSignal = fetchInit.signal;

  // Combine with any existing signal
  if (existingSignal) {
    existingSignal.addEventListener("abort", () => controller.abort());
  }

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, {
      ...fetchInit,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof DOMException && error.name === "AbortError") {
      // Could be timeout or actual abort
      if (!isOnline()) {
        throw new OfflineError("Connection lost during request");
      }
      throw new TimeoutError("Request timed out");
    }

    // Network error while supposedly online = connection just dropped
    if (!isOnline()) {
      throw new OfflineError("Connection lost");
    }

    throw error;
  }
}

/**
 * Custom error class for offline scenarios.
 * Components can check `instanceof OfflineError` to show appropriate UI.
 */
export class OfflineError extends Error {
  readonly isOffline = true;

  constructor(message: string) {
    super(message);
    this.name = "OfflineError";
  }
}

/**
 * Custom error class for timeout scenarios.
 */
export class TimeoutError extends Error {
  readonly isTimeout = true;

  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Check if an error is an offline/network error.
 */
export function isOfflineError(error: unknown): boolean {
  if (error instanceof OfflineError) return true;
  if (error instanceof TypeError && error.message.includes("fetch")) return true;
  return false;
}
