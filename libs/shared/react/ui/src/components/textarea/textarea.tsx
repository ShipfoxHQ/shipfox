'use client';

import {cva, type VariantProps} from 'class-variance-authority';
import type {ComponentProps} from 'react';
import {forwardRef} from 'react';
import {cn} from '#utils/cn.js';

export const textareaVariants = cva('', {
  variants: {
    variant: {
      base: 'bg-background-field-base',
      component: 'bg-background-field-component',
    },
    size: {
      base: 'py-6',
      small: 'py-4',
    },
  },
  defaultVariants: {
    variant: 'base',
    size: 'base',
  },
});

export type TextareaProps = ComponentProps<'textarea'> & VariantProps<typeof textareaVariants>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({className, variant, size, ...props}, ref) => {
    return (
      <textarea
        ref={ref}
        data-slot="textarea"
        className={cn(
          'w-full min-w-0 resize-y rounded-6 px-8 text-sm leading-20 text-foreground-neutral-base shadow-button-neutral transition-[color,box-shadow] outline-none placeholder:text-foreground-neutral-muted',
          'hover:bg-background-field-hover',
          'selection:bg-background-accent-neutral-soft selection:text-foreground-neutral-on-inverted',
          'read-only:cursor-not-allowed read-only:bg-background-neutral-disabled read-only:shadow-none read-only:text-foreground-neutral-disabled read-only:hover:bg-background-neutral-disabled',
          'disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-background-neutral-disabled disabled:shadow-none disabled:text-foreground-neutral-disabled',
          'focus-visible:shadow-border-interactive-with-active',
          'aria-invalid:shadow-border-error',
          textareaVariants({variant, size}),
          className,
        )}
        {...props}
      />
    );
  },
);

Textarea.displayName = 'Textarea';
