'use client';

import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import {Icon} from '../icon/index.js';

export interface LogWrapToggleProps extends Omit<ComponentProps<'button'>, 'aria-pressed'> {
  /** Whether the line is currently wrapped — drives the chevron and the label. */
  wrapped: boolean;
  /** Whether this line overrides the container's wrap, pinning the control on. */
  overridden?: boolean;
}

/**
 * A per-line wrap affordance: a chevron button that reveals on row hover (it
 * reads the `group/log-row` set by `LogRow`) and stays pinned when the line
 * overrides the container's wrap. Compose it into a `LogRow` body and wire
 * `onClick` to your wrap store — it holds no wrap state of its own.
 */
export function LogWrapToggle({
  className,
  wrapped,
  overridden = false,
  ...props
}: LogWrapToggleProps) {
  return (
    <button
      type="button"
      data-slot="log-wrap-toggle"
      aria-pressed={wrapped}
      aria-label={wrapped ? 'Collapse line' : 'Wrap line'}
      className={cn(
        'flex h-20 w-20 flex-none items-center justify-center rounded-4 transition',
        'opacity-0 group-hover/log-row:opacity-100 focus-visible:opacity-100',
        overridden
          ? 'text-foreground-highlight-interactive opacity-100'
          : 'text-foreground-neutral-muted hover:text-foreground-neutral-base',
        className,
      )}
      {...props}
    >
      <Icon
        name="chevronRight"
        className={cn('size-16 transition-transform', wrapped && 'rotate-90')}
      />
    </button>
  );
}
