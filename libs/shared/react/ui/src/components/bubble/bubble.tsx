// Adapted from shadcn/ui (MIT). See THIRD_PARTY_NOTICES.md at the package root.

import {cva, type VariantProps} from 'class-variance-authority';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';

const bubbleVariants = cva(
  // `Markdown` ends every block with a margin, which would unbalance the padding.
  'w-fit max-w-[85%] min-w-0 rounded-12 px-12 py-8 text-sm leading-20 wrap-anywhere text-foreground-neutral-base [&>*>:last-child]:mb-0',
  {
    variants: {
      variant: {
        default: 'whitespace-pre-wrap bg-background-components-base',
        muted: 'border border-border-neutral-base bg-background-bubble-muted',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export type BubbleProps = ComponentProps<'div'> & VariantProps<typeof bubbleVariants>;

/**
 * One chat message. `default` holds the user's plain text and keeps its line breaks.
 * `muted` holds the agent's reply, usually as `Markdown`. Place it in a `Message`, which sets
 * its alignment.
 */
export function Bubble({variant = 'default', className, ...props}: BubbleProps) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      className={cn(bubbleVariants({variant}), className)}
      {...props}
    />
  );
}
