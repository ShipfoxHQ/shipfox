'use client';

import {cva, type VariantProps} from 'class-variance-authority';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import {formatLogTimestamp} from './format-timestamp.js';
import {LogRowContextProvider, useLogRowsContext} from './log-context.js';

const logRowTone = cva('', {
  variants: {
    tone: {
      default: '',
      error: 'bg-red-50 dark:bg-red-500/10 shadow-[inset_2px_0_0_var(--color-red-500)]',
      warning: 'bg-orange-50 dark:bg-orange-500/10 shadow-[inset_2px_0_0_var(--color-orange-500)]',
      info: 'bg-blue-50 dark:bg-blue-500/10 shadow-[inset_2px_0_0_var(--color-blue-500)]',
      accent:
        'bg-primary-50 dark:bg-primary-500/10 shadow-[inset_2px_0_0_var(--color-primary-400)]',
    },
  },
  defaultVariants: {tone: 'default'},
});

export type LogRowTone = NonNullable<VariantProps<typeof logRowTone>['tone']>;

export interface LogRowProps extends ComponentProps<'div'> {
  /** Gutter number; `null` renders a blank cell (used by markers). */
  lineNumber?: number | null;
  /** Row time; the container's mode formats it. `null` renders a blank cell. */
  timestamp?: Date | null;
  /** Left accent bar + background tint. */
  tone?: LogRowTone;
  /** Left padding of the body in px — pass `depth * step` for nested content. */
  indent?: number;
  /** Cursor / active row for keyboard traversal. */
  selected?: boolean;
  /** Override the container's soft-wrap for this row. */
  wrap?: boolean;
}

/**
 * The structure for a single row: a line-number gutter, an optional timestamp
 * column, and a body that holds an optional `LogHeader` and a `LogContent`. It
 * owns tone, indent and wrap — pure layout that never inspects its children.
 */
export function LogRow({
  className,
  children,
  lineNumber = null,
  timestamp = null,
  tone = 'default',
  indent = 0,
  selected = false,
  wrap,
  ...props
}: LogRowProps) {
  const context = useLogRowsContext();
  const resolvedWrap = wrap ?? context.wrap;
  const showTime = context.timestamps !== 'off';
  const timeText = timestamp
    ? formatLogTimestamp(timestamp, {mode: context.timestamps, origin: context.origin})
    : '';

  return (
    <LogRowContextProvider value={{wrap: resolvedWrap}}>
      <div
        data-slot="log-row"
        data-selected={selected || undefined}
        aria-current={selected || undefined}
        className={cn(
          'flex items-start',
          logRowTone({tone}),
          selected &&
            'bg-background-neutral-pressed shadow-[inset_2px_0_0_var(--color-primary-400)]',
          className,
        )}
        {...props}
      >
        {context.showLineNumbers && (
          <span
            data-slot="log-row-gutter"
            aria-hidden="true"
            className={cn(
              'w-44 flex-none select-none px-12 text-right tabular-nums',
              selected ? 'text-foreground-neutral-base' : 'text-foreground-neutral-subtle',
            )}
          >
            {lineNumber ?? ''}
          </span>
        )}
        {showTime && (
          <span
            data-slot="log-row-time"
            className="w-80 flex-none select-none px-4 text-foreground-neutral-muted tabular-nums"
          >
            {timeText}
          </span>
        )}
        <div
          data-slot="log-row-body"
          className={cn('min-w-0 flex-1 pr-12', resolvedWrap ? '' : 'overflow-x-auto scrollbar')}
          style={{paddingLeft: indent || 12}}
        >
          {children}
        </div>
      </div>
    </LogRowContextProvider>
  );
}
