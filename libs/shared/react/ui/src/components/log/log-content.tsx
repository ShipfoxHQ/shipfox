'use client';

import {cva, type VariantProps} from 'class-variance-authority';
import type {ComponentProps, ReactNode} from 'react';
import {cn} from '#utils/cn.js';
import {parseAnsi} from './ansi.js';
import {useLogRowContext, useLogRowsContext} from './log-context.js';

const logContentVariants = cva('block leading-20', {
  variants: {
    variant: {
      text: 'font-display whitespace-normal break-words',
      code: 'font-code',
    },
  },
  defaultVariants: {variant: 'text'},
});

export interface LogContentProps
  extends Omit<ComponentProps<'span'>, 'children'>,
    VariantProps<typeof logContentVariants> {
  /** Body content; a string for text / code, or any element. */
  children?: ReactNode;
  /** Parse SGR escape codes from a string child (code variant). */
  ansi?: boolean;
  /** Override soft-wrap for this content. */
  wrap?: boolean;
}

/**
 * The body. `variant` selects typography: `text` for prose, `code` for
 * monospace output with whitespace preserved (and optional ANSI parsing). It
 * also takes arbitrary children, so anything custom drops straight in.
 */
export function LogContent({
  className,
  children,
  variant = 'text',
  ansi = false,
  wrap,
  ...props
}: LogContentProps) {
  const rowsContext = useLogRowsContext();
  const rowContext = useLogRowContext();
  const resolvedWrap = wrap ?? rowContext?.wrap ?? rowsContext.wrap;

  const whitespace =
    variant === 'code' ? (resolvedWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre') : '';

  const body =
    ansi && typeof children === 'string'
      ? parseAnsi(children).map((span) => (
          <span key={span.start} className={span.className || undefined}>
            {span.text}
          </span>
        ))
      : children;

  return (
    <span
      data-slot="log-content"
      className={cn(logContentVariants({variant}), whitespace, className)}
      {...props}
    >
      {body}
    </span>
  );
}
