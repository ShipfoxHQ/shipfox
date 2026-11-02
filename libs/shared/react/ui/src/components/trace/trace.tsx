'use client';

// Adapted from shadcn/ui (MIT). See THIRD_PARTY_NOTICES.md at the package root.

import type {ComponentProps} from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#components/collapsible/index.js';
import {Icon, type IconName} from '#components/icon/index.js';
import {Code} from '#components/typography/index.js';
import {cn} from '#utils/cn.js';

/** Use `unknown` for a tool call with no result. It must not read as failed, because a write may have applied. */
export type TraceStatus = 'running' | 'succeeded' | 'failed' | 'unknown';

const statusGlyphs: Record<TraceStatus, {label: string; icon: IconName; className: string}> = {
  running: {
    label: 'Running',
    icon: 'loader4Line',
    className: 'text-tag-blue-icon motion-safe:animate-spin',
  },
  succeeded: {label: 'Succeeded', icon: 'check', className: 'text-foreground-neutral-muted'},
  failed: {label: 'Failed', icon: 'closeCircleFill', className: 'text-tag-error-icon'},
  unknown: {
    label: 'Result unknown',
    icon: 'questionLine',
    className: 'text-foreground-neutral-muted',
  },
};

export function Trace({className, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="trace"
      className={cn('flex w-full min-w-0 flex-col gap-2', className)}
      {...props}
    />
  );
}

export interface TraceLineProps extends ComponentProps<'span'> {
  status: TraceStatus;
}

/**
 * One tool call. Use it alone for a row with nothing to expand, or inside
 * `TraceCollapsibleTrigger`. The glyph carries the status as its accessible name.
 */
export function TraceLine({status, className, children, ...props}: TraceLineProps) {
  const glyph = statusGlyphs[status];

  return (
    <span
      data-slot="trace-line"
      data-status={status}
      className={cn(
        'flex min-h-28 min-w-0 flex-1 items-center gap-4 px-6 text-sm text-foreground-neutral-subtle',
        className,
      )}
      {...props}
    >
      <Icon
        name={glyph.icon}
        role="img"
        aria-label={glyph.label}
        className={cn('size-16 shrink-0', glyph.className)}
      />
      {/* Excludes the glyph, so the title's `max-w-full` truncates inside the row. */}
      <span className="flex min-w-0 flex-1 items-center gap-4">{children}</span>
    </span>
  );
}

export function TraceTitle({className, ...props}: ComponentProps<'span'>) {
  return (
    <span
      data-slot="trace-title"
      className={cn('max-w-full flex-none truncate', className)}
      {...props}
    />
  );
}

/** The tool's target, such as a run or a file. It truncates before the title does. */
export function TraceDescription({className, ...props}: ComponentProps<'span'>) {
  return (
    <Code
      as="span"
      data-slot="trace-description"
      className={cn('min-w-0 truncate', className)}
      {...props}
    />
  );
}

export function TraceCollapsible({className, ...props}: ComponentProps<typeof Collapsible>) {
  return (
    <Collapsible
      data-slot="trace-collapsible"
      className={cn('flex w-full min-w-0 flex-col', className)}
      {...props}
    />
  );
}

export function TraceCollapsibleTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof CollapsibleTrigger>) {
  return (
    <CollapsibleTrigger
      data-slot="trace-collapsible-trigger"
      className={cn(
        'group/trace-trigger flex w-full min-w-0 cursor-pointer items-center rounded-6 pr-6 text-left transition-colors hover:bg-background-neutral-hover',
        // A nested row sits inside `overflow-hidden` content, which crops an
        // outset ring. `!` is needed because tailwind-merge can't strip the
        // base focus shadow.
        'focus-visible:shadow-focus-inset!',
        className,
      )}
      {...props}
    >
      {children}
      <Icon
        name="chevronRight"
        aria-hidden="true"
        className="size-16 shrink-0 text-foreground-neutral-muted motion-safe:transition-transform group-data-[state=open]/trace-trigger:rotate-90"
      />
    </CollapsibleTrigger>
  );
}

/** Holds a `TraceDetail`, or a nested `Trace` for a group of rows. `className` styles the inner body. */
export function TraceCollapsibleContent({
  className,
  children,
  ...props
}: ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent data-slot="trace-collapsible-content" {...props}>
      <div className={cn('flex min-w-0 flex-col gap-2 pt-2 pb-4 pl-26', className)}>{children}</div>
    </CollapsibleContent>
  );
}

/**
 * The contrast code surface. Long output scrolls here and stops at the edges, so
 * it never moves the transcript. It takes focus, so keyboard users can scroll it.
 */
export function TraceDetail({
  className,
  'aria-label': ariaLabel = 'Tool detail',
  ...props
}: ComponentProps<'div'>) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset groups form controls, and this labels scrolling output.
    <div
      data-slot="trace-detail"
      role="group"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be reachable by keyboard.
      tabIndex={0}
      aria-label={ariaLabel}
      className={cn(
        'max-h-240 min-w-0 overflow-auto overscroll-contain rounded-6 border border-border-contrast-bottom bg-background-contrast-base px-12 py-8 font-code text-xs leading-20 whitespace-pre text-foreground-contrast-primary outline-none',
        'focus-visible:shadow-focus-inset',
        className,
      )}
      {...props}
    />
  );
}
