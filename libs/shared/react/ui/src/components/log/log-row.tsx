'use client';

import {cva, type VariantProps} from 'class-variance-authority';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import {LogRowFrame} from './log-row-frame.js';

const logRowTone = cva('', {
  variants: {
    tone: {
      default: '',
      error: 'bg-red-50 dark:bg-red-500/10 shadow-[inset_2px_0_0_var(--color-red-500)]',
      warning: 'bg-orange-50 dark:bg-orange-500/10 shadow-[inset_2px_0_0_var(--color-orange-500)]',
      success: 'bg-green-50 dark:bg-green-500/10 shadow-[inset_2px_0_0_var(--color-green-500)]',
      info: 'bg-blue-50 dark:bg-blue-500/10 shadow-[inset_2px_0_0_var(--color-blue-500)]',
      // Reserve brand orange for the `selected` affordance; the agent/highlight
      // tone reads violet, matching the agent mock and staying clear of warning.
      accent: 'bg-purple-50 dark:bg-purple-500/10 shadow-[inset_2px_0_0_var(--color-purple-500)]',
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
  tone?: LogRowTone;
  /** Nesting depth level; resolved to px via the container's `indentStep`. */
  indent?: number;
  selected?: boolean;
  /** Override the container's soft-wrap for this row. */
  wrap?: boolean;
}

/**
 * Primitive output-line renderer. It layers a row `tone` on top of the shared
 * `LogRowFrame` (gutter, timestamp, indent, selected, wrap context) but does not
 * inspect or reshape its children.
 */
export function LogRow({className, children, tone = 'default', ...props}: LogRowProps) {
  return (
    <LogRowFrame className={cn(logRowTone({tone}), className)} {...props}>
      {children}
    </LogRowFrame>
  );
}
