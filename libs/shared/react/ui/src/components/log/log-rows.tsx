'use client';

import type {ComponentProps, KeyboardEvent} from 'react';
import {cn} from '#utils/cn.js';
import type {LogTimestampMode} from './format-timestamp.js';
import {LogRowsContextProvider} from './log-context.js';

export interface LogRowsProps extends ComponentProps<'div'> {
  timestamps?: LogTimestampMode;
  wrap?: boolean;
  showLineNumbers?: boolean;
  /** Pixels of body inset per nesting depth level; a row at level `n` insets `n * indentStep`. */
  indentStep?: number;
  /** Baseline for relative timestamps; without one, relative mode falls back to absolute time. */
  timestampOrigin?: Date;
  /** Adds pointer and keyboard shortcuts to switch rel/abs for all rows. */
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
  indentStep = 16,
  timestampOrigin,
  onTimestampsClick,
  onKeyDown,
  tabIndex,
  'aria-description': ariaDescription,
  ...props
}: LogRowsProps) {
  const canToggleTimestamps = onTimestampsClick !== undefined && timestamps !== 'off';
  const timestampToggleDescription =
    timestamps === 'abs'
      ? 'Press Enter or Space to show relative timestamps.'
      : 'Press Enter or Space to show absolute timestamps.';
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.currentTarget !== event.target) return;
    if (!canToggleTimestamps || (event.key !== 'Enter' && event.key !== ' ')) return;

    event.preventDefault();
    onTimestampsClick();
  };

  return (
    <LogRowsContextProvider
      value={{timestamps, wrap, showLineNumbers, indentStep, timestampOrigin, onTimestampsClick}}
    >
      <div
        data-slot="log-rows"
        role="log"
        aria-live="polite"
        aria-description={
          ariaDescription ?? (canToggleTimestamps ? timestampToggleDescription : undefined)
        }
        aria-keyshortcuts={canToggleTimestamps ? 'Enter Space' : undefined}
        tabIndex={tabIndex ?? (canToggleTimestamps ? 0 : undefined)}
        onKeyDown={handleKeyDown}
        className={cn(
          'overflow-y-auto rounded-12 border border-border-contrast-bottom shadow-button-neutral',
          'bg-background-contrast-subtle',
          'py-8 font-code text-xs leading-20 text-foreground-contrast-primary',
          'scrollbar outline-none focus-visible:shadow-focus-inset',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </LogRowsContextProvider>
  );
}
