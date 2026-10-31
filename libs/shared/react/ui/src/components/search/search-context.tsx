'use client';

import {createContext, useContext, useEffect} from 'react';

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

export function useKeyboardShortcut(shortcutKey: string | undefined, onTrigger: () => void) {
  useEffect(() => {
    if (!shortcutKey) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = shortcutKey.toLowerCase();
      const isMetaKey = key.startsWith('meta+') || key.startsWith('cmd+') || key.startsWith('⌘');
      const isCtrlKey = key.startsWith('ctrl+');
      const targetKey = key.replace(shortcutKeyRegex, '');

      const shouldTrigger = shortcutMatches(event, targetKey, isMetaKey, isCtrlKey);

      if (!shouldTrigger) return;

      if (!isMetaKey && !isCtrlKey && isEditableTarget(event.target)) return;

      event.preventDefault();
      onTrigger();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [shortcutKey, onTrigger]);
}

function shortcutMatches(
  event: KeyboardEvent,
  targetKey: string,
  isMetaKey: boolean,
  isCtrlKey: boolean,
): boolean {
  if (isMetaKey) return event.metaKey && event.key.toLowerCase() === targetKey;
  if (isCtrlKey) return event.ctrlKey && event.key.toLowerCase() === targetKey;
  return event.key.toLowerCase() === targetKey && !event.metaKey && !event.ctrlKey;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}
