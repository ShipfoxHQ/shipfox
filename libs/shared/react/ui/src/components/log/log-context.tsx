'use client';

import {createContext, useContext} from 'react';
import type {LogTimestampMode} from './format-timestamp.js';

/**
 * Defaults the container provides to every row: time-column mode, soft-wrap,
 * the line-number gutter, and the baseline for relative timestamps. A `LogRow`
 * used outside a `LogRows` reads these fallbacks.
 */
export interface LogRowsContextValue {
  timestamps: LogTimestampMode;
  wrap: boolean;
  showLineNumbers: boolean;
  timestampOrigin?: Date | undefined;
  /** When set, the timestamp column renders as a button that calls this. */
  onTimestampsClick?: (() => void) | undefined;
}

export const defaultLogRowsContext: LogRowsContextValue = {
  timestamps: 'off',
  wrap: false,
  showLineNumbers: true,
};

const LogRowsContext = createContext<LogRowsContextValue>(defaultLogRowsContext);

export const LogRowsContextProvider = LogRowsContext.Provider;

export function useLogRowsContext(): LogRowsContextValue {
  return useContext(LogRowsContext);
}

/**
 * What a `LogRow` publishes to its own body so a nested `LogContent` inherits
 * the row's resolved wrap before falling back to the container default.
 */
export interface LogRowContextValue {
  wrap: boolean;
}

const LogRowContext = createContext<LogRowContextValue | null>(null);

export const LogRowContextProvider = LogRowContext.Provider;

export function useLogRowContext(): LogRowContextValue | null {
  return useContext(LogRowContext);
}
