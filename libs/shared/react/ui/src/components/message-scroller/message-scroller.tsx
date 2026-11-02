'use client';

// Adapted from shadcn/ui (MIT). See THIRD_PARTY_NOTICES.md at the package root.

import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from '@shadcn/react/message-scroller';
import type {ComponentProps, MouseEvent} from 'react';
import {Button} from '#components/button/index.js';
import {useMediaQuery} from '#hooks/useMediaQuery.js';
import {cn} from '#utils/cn.js';

export {useMessageScroller, useMessageScrollerScrollable, useMessageScrollerVisibility};

/**
 * Owns the scroll state and renders no element. It follows new content while the reader is at
 * the latest message. A scroll gesture stops that, and returning to the latest message resumes it.
 */
export function MessageScrollerProvider({
  autoScroll = true,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Provider>) {
  return <MessageScrollerPrimitive.Provider autoScroll={autoScroll} {...props} />;
}

/** Fills its parent, so the parent must have a bounded height. */
export function MessageScroller({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn('relative flex size-full min-h-0 flex-col overflow-hidden', className)}
      {...props}
    />
  );
}

export function MessageScrollerViewport({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      className={cn(
        'scrollbar size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain outline-none [scrollbar-gutter:stable] contain-content',
        'focus-visible:shadow-focus-inset data-pending-scroll:invisible',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The transcript, as a `log` that stays silent by default, because a screen reader would
 * otherwise read each streamed token. The feature announces replies in its own status region.
 */
export function MessageScrollerContent({
  className,
  'aria-live': ariaLive = 'off',
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      aria-live={ariaLive}
      className={cn('flex h-max min-h-full flex-col gap-12 p-12', className)}
      {...props}
    />
  );
}

/** One transcript row. Set `scrollAnchor` on a sent message to place it near the top. */
export function MessageScrollerItem({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    // Upstream adds `content-visibility: auto`. A new row then lays out at its estimated height
    // for a frame, and the sent message visibly jumps before it settles near the top.
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      className={cn('min-w-0 shrink-0', className)}
      {...props}
    />
  );
}

export type MessageScrollerButtonProps = Omit<
  ComponentProps<typeof MessageScrollerPrimitive.Button>,
  'direction' | 'render'
>;

/** `Jump to latest`. It shows only while newer content sits below the viewport. */
export function MessageScrollerButton({
  behavior,
  className,
  children = 'Jump to latest',
  onClick,
  ...props
}: MessageScrollerButtonProps) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;

    // The button turns inert at the latest message, which would drop keyboard focus to the body.
    event.currentTarget
      .closest('[data-slot="message-scroller"]')
      ?.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')
      ?.focus({preventScroll: true});
  }

  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      direction="end"
      behavior={behavior ?? (reducedMotion ? 'auto' : 'smooth')}
      className={cn(
        'absolute bottom-12 left-1/2 -translate-x-1/2 duration-150 ease-out motion-safe:transition-[background-color,opacity,translate]',
        'data-[active=false]:translate-y-8 data-[active=false]:opacity-0',
        className,
      )}
      render={<Button variant="secondary" size="xs" iconLeft="arrowDownLine" />}
      onClick={handleClick}
      {...props}
    >
      {children}
    </MessageScrollerPrimitive.Button>
  );
}
