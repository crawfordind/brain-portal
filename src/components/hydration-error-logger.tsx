"use client";

import { useEffect } from 'react';

/**
 * HydrationErrorLogger - Catches and logs hydration errors for debugging
 *
 * This component sets up global error handlers to catch hydration errors
 * that might not be caught by React error boundaries.
 */
export function HydrationErrorLogger() {
  useEffect(() => {
    // Catch unhandled errors
    const handleError = (event: ErrorEvent) => {
      const error = event.error;

      // Check if it's a hydration error
      if (
        error?.message?.includes('Hydration') ||
        error?.message?.includes('hydration') ||
        error?.message?.includes('Minified React error #418') ||
        error?.message?.includes('Minified React error #423') ||
        error?.message?.includes('Minified React error #425')
      ) {
        console.error('[HydrationErrorLogger] Hydration error detected!');
        console.error('[HydrationErrorLogger] Error:', {
          message: error.message,
          stack: error.stack,
          url: event.filename,
          line: event.lineno,
          col: event.colno,
        });

        // Log to Vercel (shows up in logs)
        console.error('HYDRATION_ERROR:', {
          message: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
          url: window.location.href,
        });
      }
    };

    // Catch unhandled promise rejections
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;

      if (
        reason?.message?.includes('Hydration') ||
        reason?.message?.includes('hydration')
      ) {
        console.error('[HydrationErrorLogger] Hydration error in promise:');
        console.error('[HydrationErrorLogger] Reason:', reason);

        console.error('HYDRATION_ERROR_PROMISE:', {
          message: reason?.message,
          stack: reason?.stack,
          timestamp: new Date().toISOString(),
          url: window.location.href,
        });
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    console.log('[HydrationErrorLogger] Error handlers attached');

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return null;
}
