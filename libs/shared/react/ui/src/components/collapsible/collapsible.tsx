'use client';

import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';

function Collapsible({...props}: ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({
  className,
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      className={cn('outline-none', className)}
      {...props}
    />
  );
}

function CollapsibleContent({
  className,
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      className={cn(
        // Radix publishes the measured height on the element as a CSS variable;
        // the tw-animate-css keyframes read it to animate between 0 and auto.
        'overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down',
        className,
      )}
      {...props}
    />
  );
}

export {Collapsible, CollapsibleContent, CollapsibleTrigger};
