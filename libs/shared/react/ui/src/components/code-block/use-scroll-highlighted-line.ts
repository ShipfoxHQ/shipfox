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

export function useScrollHighlightedLineIntoView(
  ref: RefObject<HTMLElement | null>,
  {enabled, highlightedLineRange}: ScrollHighlightedLineOptions,
): void {
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
      // Layout-less test environments may expose a partial scrollIntoView.
    }
  }, [enabled, startLine, ref]);
}
