// Adapted from shadcn/ui (MIT). See THIRD_PARTY_NOTICES.md at the package root.

import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';

export interface MessageProps extends ComponentProps<'div'> {
  align?: 'start' | 'end';
}

export function Message({align = 'start', className, ...props}: MessageProps) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn(
        'flex w-full min-w-0 flex-col items-start gap-4 data-[align=end]:items-end',
        className,
      )}
      {...props}
    />
  );
}

/** Short status below a bubble, such as `Stopped` or a `Queued` chip. */
export function MessageFooter({className, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="message-footer"
      className={cn(
        'flex max-w-full min-w-0 items-center gap-4 px-12 text-xs text-foreground-neutral-muted',
        className,
      )}
      {...props}
    />
  );
}
