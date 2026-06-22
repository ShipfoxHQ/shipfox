'use client';

import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import type {LogTimestampMode} from './format-timestamp.js';
import {LogRowsContextProvider} from './log-context.js';

export interface LogRowsProps extends ComponentProps<'div'> {
  /** Time-column mode shared by every row. */
  timestamps?: LogTimestampMode;
  /** Default soft-wrap applied to rows that do not override it. */
  wrap?: boolean;
  /** Show the line-number gutter across the list. */
  showLineNumbers?: boolean;
  /** Baseline that relative timestamps are measured from. */
  timestampOrigin?: Date;
  /** When set, the timestamp column becomes a button that calls this (e.g. to switch rel/abs for all rows). */
  onTimestampsClick?: () => void;
}

/**
 * The scroll surface that wraps the rows. It owns nothing about what a row
 * contains; it only provides the shared defaults every `LogRow` reads
 * (timestamp mode, wrap, line numbers) and the code-surface chrome.
 */
export function LogRows({
  className,
  children,
  timestamps = 'off',
  wrap = false,
  showLineNumbers = true,
  timestampOrigin,
  onTimestampsClick,
  ...props
}: LogRowsProps) {
  return (
    <LogRowsContextProvider
      value={{timestamps, wrap, showLineNumbers, timestampOrigin, onTimestampsClick}}
    >
      <div
        data-slot="log-rows"
        role="log"
        aria-live="polite"
        className={cn(
          'overflow-y-auto rounded-12 border border-border-contrast-bottom shadow-button-neutral',
          'bg-background-neutral-base dark:bg-background-contrast-subtle',
          'py-8 font-code text-xs leading-20 text-foreground-neutral-base',
          'scrollbar',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </LogRowsContextProvider>
  );
}
