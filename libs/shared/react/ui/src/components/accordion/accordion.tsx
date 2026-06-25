'use client';

import * as AccordionPrimitive from '@radix-ui/react-accordion';
import type {ComponentProps, ReactNode} from 'react';
import {cn} from '#utils/cn.js';
import {Icon} from '../icon/index.js';

function Accordion({className, ...props}: ComponentProps<typeof AccordionPrimitive.Root>) {
  return (
    <AccordionPrimitive.Root data-slot="accordion" className={cn('w-full', className)} {...props} />
  );
}

function AccordionItem({className, ...props}: ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn('border-b border-border-neutral-base last:border-b-0', className)}
      {...props}
    />
  );
}

type AccordionTriggerBaseProps = Omit<
  ComponentProps<typeof AccordionPrimitive.Trigger>,
  'asChild' | 'children'
> & {
  showIcon?: boolean | undefined;
  iconClassName?: string | undefined;
};

type AccordionTriggerProps =
  | (AccordionTriggerBaseProps & {
      children: ReactNode;
      'aria-label'?: string | undefined;
    })
  | (AccordionTriggerBaseProps & {
      children?: undefined;
      'aria-label': string;
    });

function AccordionTrigger({
  className,
  children,
  showIcon = true,
  iconClassName,
  ...props
}: AccordionTriggerProps) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          'group flex min-h-40 w-full items-center justify-between gap-8 px-12 py-8 text-left text-foreground-neutral-base outline-none transition-colors hover:bg-background-components-hover focus-visible:shadow-border-interactive-with-active disabled:cursor-not-allowed disabled:text-foreground-neutral-disabled disabled:hover:bg-transparent',
          className,
        )}
        {...props}
      >
        {children}
        {showIcon ? (
          <Icon
            name="chevronRight"
            aria-hidden="true"
            className={cn(
              'size-16 shrink-0 text-foreground-neutral-muted transition-transform group-data-[state=open]:rotate-90',
              iconClassName,
            )}
          />
        ) : null}
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({
  className,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className={cn(
        'overflow-hidden px-12 py-8 text-sm text-foreground-neutral-subtle motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down',
        className,
      )}
      {...props}
    />
  );
}

export {Accordion, AccordionContent, AccordionItem, AccordionTrigger};
