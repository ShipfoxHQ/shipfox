'use client';

import * as React from 'react';
import type {ComboboxOption} from './combobox-state.js';

export type ComboboxContextValue = {
  options: ComboboxOption[];
  multiple: boolean;
  disabled: boolean;
  isLoading: boolean;
  maxVisibleChips: number | undefined;
  listId: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  searchValue: string;
  setSearchValue: (value: string) => void;
  visibleOptions: ComboboxOption[];
  activeValue: string | null;
  setActiveValue: (value: string | null) => void;
  selectedValue: string;
  selectedValues: string[];
  getLabel: (value: string) => string;
  isSelected: (value: string) => boolean;
  selectValue: (value: string) => void;
  removeValue: (value: string) => void;
  removeLastValue: () => void;
  clearValues: () => void;
  onListKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
};

// Keyed by value (not list position) so custom ComboboxItem composition keeps a
// stable, resolvable id for aria-activedescendant. encodeURIComponent keeps the id
// free of whitespace/invalid characters for arbitrary option values.
export function comboboxOptionId(listId: string, value: string): string {
  return `${listId}-option-${encodeURIComponent(value)}`;
}

export function activeDescendantId(listId: string, activeValue: string | null): string | undefined {
  return activeValue === null ? undefined : comboboxOptionId(listId, activeValue);
}

export const ComboboxContext = React.createContext<ComboboxContextValue | null>(null);

export function useComboboxContext() {
  const context = React.useContext(ComboboxContext);
  if (!context) {
    throw new Error('Combobox components must be used within a ComboboxRoot.');
  }
  return context;
}
