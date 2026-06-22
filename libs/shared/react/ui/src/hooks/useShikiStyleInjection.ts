'use client';

import {useEffect} from 'react';

const STYLE_ID = 'shiki-override-styles';

// The override style is shared by every highlighted block on the page, so its
// lifetime is reference-counted: the node is created on the first mount and
// removed only once the last highlighted block unmounts. Without the counter
// the first block to unmount would delete the style out from under the others.
let activeInjections = 0;

export function useShikiStyleInjection(syntaxHighlighting: boolean): void {
  useEffect(() => {
    if (!syntaxHighlighting) {
      return;
    }

    activeInjections += 1;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        .shiki-override pre,
        .shiki-override code,
        .shiki-override pre *,
        .shiki-override code * {
          background: transparent !important;
          font-family: var(--font-code, monospace) !important;
        }
      `;
      document.head.appendChild(style);
    }

    return () => {
      activeInjections -= 1;
      if (activeInjections <= 0) {
        activeInjections = 0;
        document.getElementById(STYLE_ID)?.remove();
      }
    };
  }, [syntaxHighlighting]);
}
