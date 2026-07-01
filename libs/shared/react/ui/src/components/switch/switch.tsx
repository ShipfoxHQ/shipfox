'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import {cva, type VariantProps} from 'class-variance-authority';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';

export const switchVariants = cva(
  'peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-none transition-colors duration-200 outline-none',
  {
    variants: {
      size: {
        sm: 'h-20 w-36',
        md: 'h-24 w-44',
        lg: 'h-28 w-52',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

export const switchThumbVariants = cva(
  'pointer-events-none block rounded-full bg-white shadow-button-neutral transition-transform duration-200',
  {
    variants: {
      size: {
        sm: 'size-16 data-[state=checked]:translate-x-18 data-[state=unchecked]:translate-x-2',
        md: 'size-20 data-[state=checked]:translate-x-22 data-[state=unchecked]:translate-x-2',
        lg: 'size-24 data-[state=checked]:translate-x-26 data-[state=unchecked]:translate-x-2',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

export type SwitchProps = ComponentProps<typeof SwitchPrimitive.Root> &
  VariantProps<typeof switchVariants>;

export function Switch({className, size, ...props}: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        switchVariants({size}),
        'bg-background-switch-off hover:bg-background-switch-off-hover',
        'data-[state=checked]:bg-checkbox-checked-bg data-[state=checked]:hover:bg-checkbox-checked-bg-hover',
        'focus-visible:shadow-checkbox-unchecked-focus data-[state=checked]:focus-visible:shadow-checkbox-checked-focus',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className={switchThumbVariants({size})} />
    </SwitchPrimitive.Root>
  );
}
