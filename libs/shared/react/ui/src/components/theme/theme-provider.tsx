'use client';

import {type ReactNode, useEffect, useMemo, useState} from 'react';
import {type Theme, ThemeProviderContext} from '#state/theme.js';
import {
  type BrowserStorageKey,
  createTypedBrowserStorage,
  localStorageOrUndefined,
} from '#utils/browser-storage.js';

type ThemeProviderProps = {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'shipfox-theme',
  ...props
}: ThemeProviderProps) {
  const storage = useMemo(
    () =>
      createTypedBrowserStorage(localStorageOrUndefined, {
        key: storageKey,
        lifetime: 'persistent',
        principalScope: 'global',
        serialize: (value: Theme) => value,
        parse: (value: string) =>
          value === 'light' || value === 'dark' || value === 'system' ? value : undefined,
      } satisfies BrowserStorageKey<Theme>),
    [storageKey],
  );
  const [theme, setTheme] = useState<Theme>(() => storage.read() ?? defaultTheme);

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';

      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      storage.write(theme);
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}
