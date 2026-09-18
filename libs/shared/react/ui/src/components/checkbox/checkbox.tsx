'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import {Icon} from '../icon/index.js';

export type CheckedState = CheckboxPrimitive.CheckedState;
export type CheckboxProps = ComponentProps<typeof CheckboxPrimitive.Root>;

export function Checkbox({className, ...props}: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'inline-flex size-16 shrink-0 cursor-pointer items-center justify-center rounded-4 border outline-none transition-[background-color,border-color,box-shadow]',
        'border-checkbox-unchecked-border bg-checkbox-unchecked-bg shadow-checkbox-unchecked hover:bg-checkbox-unchecked-bg-hover focus-visible:shadow-checkbox-unchecked-focus',
        'data-[state=checked]:border-checkbox-checked-border data-[state=checked]:bg-checkbox-checked-bg data-[state=checked]:shadow-checkbox-checked data-[state=checked]:hover:bg-checkbox-checked-bg-hover data-[state=checked]:focus-visible:shadow-checkbox-checked-focus',
        'data-[state=indeterminate]:border-checkbox-indeterminate-border data-[state=indeterminate]:bg-checkbox-indeterminate-bg data-[state=indeterminate]:shadow-checkbox-indeterminate data-[state=indeterminate]:hover:bg-checkbox-indeterminate-bg-hover data-[state=indeterminate]:focus-visible:shadow-checkbox-indeterminate-focus',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="group/indicator flex items-center justify-center text-foreground-neutral-on-color"
      >
        <Icon
          aria-hidden="true"
          name="check"
          className="size-14 group-data-[state=indeterminate]/indicator:hidden"
        />
        <Icon
          aria-hidden="true"
          name="subtractLine"
          className="hidden size-14 group-data-[state=indeterminate]/indicator:block"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
