import {type RefObject, useEffect} from 'react';
import {
  CODE_BLOCK_HIGHLIGHTED_LINE_CLASS,
  type CodeBlockHighlightedLineRange,
} from './line-highlight.js';

interface ScrollHighlightedLineOptions {
  enabled: boolean;
  highlightedLineRange: CodeBlockHighlightedLineRange | null | undefined;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * When `enabled` and a line range is highlighted, scrolls the first highlighted
 * line to the vertical center of its nearest scrollable ancestor. The owning
 * component holds the ref because only it knows when its highlighted markup has
 * rendered (the syntax-highlighted path swaps in asynchronously, so the effect
 * re-runs as the range or markup changes).
 *
 * Reduced motion and `scrollIntoView` are read at scroll time and guarded:
 * the scroll is a one-shot, best-effort nicety, and environments without layout
 * (e.g. jsdom) lack `matchMedia`/`scrollIntoView`, so neither should ever throw.
 */
export function useScrollHighlightedLineIntoView(
  ref: RefObject<HTMLElement | null>,
  {enabled, highlightedLineRange}: ScrollHighlightedLineOptions,
): void {
  // The scroll target is the first highlighted line, so its start line is the
  // only range field that changes what we scroll to.
  const startLine = highlightedLineRange?.startLine;

  useEffect(() => {
    if (!enabled || startLine === undefined) return;

    const target = ref.current?.querySelector(`.${CODE_BLOCK_HIGHLIGHTED_LINE_CLASS}`);
    if (!(target instanceof HTMLElement) || typeof target.scrollIntoView !== 'function') return;

    try {
      target.scrollIntoView({
        block: 'center',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    } catch {
      // No layout in this environment (e.g. jsdom); skip the scroll nicety.
    }
  }, [enabled, startLine, ref]);
}
