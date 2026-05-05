'use client';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';

export function RadioGroup({className, ...props}: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root className={cn('flex flex-col gap-8', className)} {...props} />;
}

export function RadioGroupItem({
  className,
  children,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'rounded-8 border border-border-neutral-base bg-background-neutral-base p-14 text-left transition-colors outline-none cursor-pointer',
        'hover:bg-background-components-hover',
        'data-[state=checked]:border-border-highlights-interactive',
        'focus-visible:shadow-button-neutral-focus',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </RadioGroupPrimitive.Item>
  );
}
