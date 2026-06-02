'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';

function Popover({...props}: ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root {...props} />;
}

function PopoverTrigger({...props}: ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger {...props} />;
}

function PopoverAnchor({...props}: ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor {...props} />;
}

function PopoverPortal({...props}: ComponentProps<typeof PopoverPrimitive.Portal>) {
  return <PopoverPrimitive.Portal {...props} />;
}

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  container,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content> & {container?: HTMLElement | null}) {
  return (
    <PopoverPortal container={container}>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-10 bg-background-neutral-overlay shadow-tooltip outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        {...props}
      />
    </PopoverPortal>
  );
}

function PopoverArrow({className, ...props}: ComponentProps<typeof PopoverPrimitive.Arrow>) {
  return (
    <PopoverPrimitive.Arrow
      className={cn('fill-background-neutral-overlay', className)}
      {...props}
    />
  );
}

function PopoverClose({...props}: ComponentProps<typeof PopoverPrimitive.Close>) {
  return <PopoverPrimitive.Close {...props} />;
}

export {Popover, PopoverAnchor, PopoverArrow, PopoverClose, PopoverContent, PopoverTrigger};
