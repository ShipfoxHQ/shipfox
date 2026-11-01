'use client';

// Adapted from shadcn/ui (MIT). See THIRD_PARTY_NOTICES.md at the package root.

import type {ComponentProps} from 'react';
import {Button} from '#components/button/index.js';
import {cn} from '#utils/cn.js';

export function Suggestions({className, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="suggestions"
      className={cn('flex w-full min-w-0 flex-col gap-4', className)}
      {...props}
    />
  );
}

export interface SuggestionProps
  extends Omit<
    ComponentProps<typeof Button>,
    'onClick' | 'children' | 'type' | 'variant' | 'size' | 'asChild' | 'isLoading'
  > {
  suggestion: string;
  onClick?: (suggestion: string) => void;
}

export function Suggestion({
  suggestion,
  onClick,
  iconLeft = 'questionLine',
  className,
  ...props
}: SuggestionProps) {
  return (
    <Button
      data-slot="suggestion"
      type="button"
      variant="secondary"
      iconLeft={iconLeft}
      className={cn('w-full min-w-0 shrink justify-start [&>svg]:size-16', className)}
      onClick={() => onClick?.(suggestion)}
      {...props}
    >
      <span className="truncate">{suggestion}</span>
    </Button>
  );
}
