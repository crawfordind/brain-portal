/**
 * Hydration Debug Logger
 *
 * Helps identify hydration mismatches by logging component renders
 * and detecting differences between server and client rendering.
 */

let renderCount = 0;

export function logRender(component: string, data?: Record<string, any>) {
  renderCount++;
  const isServer = typeof window === 'undefined';
  const prefix = isServer ? '[SSR]' : '[CLIENT]';

  console.log(`${prefix} #${renderCount} ${component}`, data || '');
}

export function logHydrationError(component: string, error: Error) {
  console.error(`[HYDRATION ERROR] ${component}:`, error);
}

// Add event listener for React hydration errors
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    if (event.message.includes('Hydration') || event.message.includes('Minified React error')) {
      console.error('[HYDRATION] Caught error:', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error,
      });
    }
  });

  // Track hydration warnings
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => {
    const message = args[0]?.toString() || '';
    if (message.includes('hydration') || message.includes('server') || message.includes('client')) {
      console.error('[HYDRATION WARNING]', ...args);
    }
    originalWarn.apply(console, args);
  };
}
