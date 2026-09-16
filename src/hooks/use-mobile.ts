import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 640; // Tailwind 'sm' breakpoint

/**
 * Detects if the viewport is below a given breakpoint
 * Defaults to Tailwind's 'sm' breakpoint (640px) for consistency with design system
 * @param breakpoint - max-width threshold in px (default: 640)
 * @returns true if viewport width is less than the breakpoint
 */
export function useMobile(breakpoint: number = MOBILE_BREAKPOINT): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    setIsMobile(mediaQuery.matches);
    const listener = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, [breakpoint]);

  return isMobile;
}
