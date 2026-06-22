'use client';

import {useEffect, useState} from 'react';

type ShikiThemes = {
  light: string;
  dark: string;
};

type UseShikiHighlightOptions = {
  code: string;
  lang: string;
  themes: ShikiThemes;
  resolvedTheme: 'light' | 'dark';
  syntaxHighlighting: boolean;
};

export function useShikiHighlight({
  code,
  lang,
  themes,
  resolvedTheme,
  syntaxHighlighting,
}: UseShikiHighlightOptions): {highlightedCode: string; isLoading: boolean} {
  const [highlightedCode, setHighlightedCode] = useState<string>('');
  const [isLoading, setIsLoading] = useState(syntaxHighlighting);

  useEffect(() => {
    if (!syntaxHighlighting) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    let cancelled = false;

    const loadHighlightedCode = async () => {
      try {
        const {codeToHtml} = await import('shiki');

        const html = await codeToHtml(code, {
          lang,
          themes: {
            light: themes.light,
            dark: themes.dark,
          },
          defaultColor: resolvedTheme === 'dark' ? 'dark' : 'light',
        });

        if (!cancelled) {
          setHighlightedCode(html);
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setHighlightedCode('');
          setIsLoading(false);
        }
      }
    };

    loadHighlightedCode();

    return () => {
      cancelled = true;
    };
  }, [code, lang, themes.light, themes.dark, resolvedTheme, syntaxHighlighting]);

  return {highlightedCode, isLoading};
}

type UseShikiHighlightMultipleOptions = {
  codes: Record<string, string>;
  lang: string;
  themes: ShikiThemes;
  resolvedTheme: 'light' | 'dark';
  syntaxHighlighting: boolean;
};

export function useShikiHighlightMultiple({
  codes,
  lang,
  themes,
  resolvedTheme,
  syntaxHighlighting,
}: UseShikiHighlightMultipleOptions): {
  highlightedCodes: Record<string, string>;
  isLoading: boolean;
} {
  const [highlightedCodes, setHighlightedCodes] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(syntaxHighlighting);

  useEffect(() => {
    if (!syntaxHighlighting) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    let cancelled = false;

    const loadHighlightedCode = async () => {
      try {
        const {codeToHtml} = await import('shiki');
        const newHighlightedCodes: Record<string, string> = {};

        for (const [command, val] of Object.entries(codes)) {
          if (cancelled) {
            return;
          }

          const highlighted = await codeToHtml(val, {
            lang,
            themes: {
              light: themes.light,
              dark: themes.dark,
            },
            defaultColor: resolvedTheme === 'dark' ? 'dark' : 'light',
          });

          newHighlightedCodes[command] = highlighted;
        }

        if (!cancelled) {
          setHighlightedCodes(newHighlightedCodes);
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setHighlightedCodes({});
          setIsLoading(false);
        }
      }
    };

    loadHighlightedCode();

    return () => {
      cancelled = true;
    };
  }, [resolvedTheme, lang, themes.light, themes.dark, codes, syntaxHighlighting]);

  return {highlightedCodes, isLoading};
}
