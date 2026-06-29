'use client';

import {createContext, useCallback, useContext, useEffect, useState} from 'react';

const shortcutKeyRegex = /^(meta\+|cmd\+|ctrl\+|⌘\+?)/i;

export type SearchContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  searchValue: string;
  setSearchValue: (value: string) => void;
  shortcutKey: string | undefined;
};

export const SearchContext = createContext<SearchContextValue | null>(null);

export function useSearchContext() {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('Search components must be used within a Search component');
  }
  return context;
}

export function useControllableState<T>(
  controlledValue: T | undefined,
  defaultValue: T,
  onChange?: (value: T) => void,
): [T, (value: T) => void] {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internalValue;

  const setValue = useCallback(
    (newValue: T) => {
      if (!isControlled) {
        setInternalValue(newValue);
      }
      onChange?.(newValue);
    },
    [isControlled, onChange],
  );

  return [value, setValue];
}

export function useKeyboardShortcut(shortcutKey: string | undefined, onTrigger: () => void) {
  useEffect(() => {
    if (!shortcutKey) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = shortcutKey.toLowerCase();
      const isMetaKey = key.startsWith('meta+') || key.startsWith('cmd+') || key.startsWith('⌘');
      const isCtrlKey = key.startsWith('ctrl+');
      const targetKey = key.replace(shortcutKeyRegex, '');

      const shouldTrigger =
        (isMetaKey && event.metaKey && event.key.toLowerCase() === targetKey) ||
        (isCtrlKey && event.ctrlKey && event.key.toLowerCase() === targetKey) ||
        (!isMetaKey &&
          !isCtrlKey &&
          event.key.toLowerCase() === targetKey &&
          !event.metaKey &&
          !event.ctrlKey);

      if (!shouldTrigger) return;

      if (!isMetaKey && !isCtrlKey) {
        const target = event.target as HTMLElement;
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable
        ) {
          return;
        }
      }

      event.preventDefault();
      onTrigger();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [shortcutKey, onTrigger]);
}
