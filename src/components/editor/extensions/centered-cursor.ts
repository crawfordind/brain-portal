import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * CenteredCursor Extension
 *
 * Keeps the active cursor line centered in the viewport while typing.
 * Similar to VS Code's "centered cursor" mode.
 *
 * PERFORMANCE: Uses requestAnimationFrame and debouncing
 * MOBILE: Falls back to scrollIntoView for better compatibility
 */
export const CenteredCursor = Extension.create({
  name: 'centeredCursor',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('centeredCursor'),

        view() {
          let rafId: number | null = null;
          let lastCursorPos: number | null = null;

          // Detect mobile
          const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

          return {
            update: (view) => {
              const { from } = view.state.selection;

              // Skip if cursor hasn't moved
              if (from === lastCursorPos) return;
              lastCursorPos = from;

              // Cancel pending scroll
              if (rafId) {
                cancelAnimationFrame(rafId);
              }

              // Schedule scroll update
              rafId = requestAnimationFrame(() => {
                try {
                  const pos = view.coordsAtPos(from);
                  if (!pos) return;

                  // Get editor container
                  const editorEl = view.dom;
                  const container = editorEl.closest('.prose') as HTMLElement;
                  if (!container) return;

                  // Mobile: Use scrollIntoView
                  if (isMobile) {
                    const cursorElement = view.domAtPos(from).node;
                    if (cursorElement instanceof HTMLElement) {
                      cursorElement.scrollIntoView({
                        block: 'center',
                        behavior: 'smooth',
                      });
                    }
                    return;
                  }

                  // Desktop: Custom centering logic
                  const containerRect = container.getBoundingClientRect();
                  const viewportCenter = containerRect.height / 2;

                  // Calculate cursor position relative to container
                  const cursorTop = pos.top - containerRect.top;

                  // Get current scroll position
                  const currentScroll = container.scrollTop;
                  const targetScroll = currentScroll + cursorTop - viewportCenter;

                  // Don't scroll if difference is small (< 50px)
                  if (Math.abs(targetScroll - currentScroll) < 50) return;

                  // Smooth scroll to center (don't scroll above top)
                  container.scrollTo({
                    top: Math.max(0, targetScroll),
                    behavior: 'smooth',
                  });
                } catch (error) {
                  // Silently fail - cursor tracking is non-critical
                  console.debug('CenteredCursor scroll error:', error);
                }
              });
            },

            destroy: () => {
              if (rafId) {
                cancelAnimationFrame(rafId);
              }
            },
          };
        },
      }),
    ];
  },
});
