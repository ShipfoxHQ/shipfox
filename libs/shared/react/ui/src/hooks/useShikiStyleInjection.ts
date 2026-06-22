'use client';

import {useEffect} from 'react';

export function useShikiStyleInjection(syntaxHighlighting: boolean): void {
  useEffect(() => {
    if (!syntaxHighlighting) {
      return;
    }

    const styleId = 'shiki-override-styles';
    if (document.getElementById(styleId)) {
      return;
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .shiki-override pre,
      .shiki-override code,
      .shiki-override pre *,
      .shiki-override code * {
        background: transparent !important;
        font-family: "Commit Mono", monospace !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      const existingStyle = document.getElementById(styleId);
      if (existingStyle) {
        existingStyle.remove();
      }
    };
  }, [syntaxHighlighting]);
}
