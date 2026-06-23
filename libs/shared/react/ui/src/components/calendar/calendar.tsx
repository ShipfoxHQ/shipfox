'use client';

import type {ComponentProps} from 'react';
import {DayPicker} from 'react-day-picker';
import {Icon} from '#components/icon/index.js';
import {cn} from '#utils/cn.js';

export type CalendarProps = ComponentProps<typeof DayPicker>;

export function Calendar({className, classNames, showOutsideDays = true, ...props}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('transition-colors', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-0',
        month:
          'space-y-16 relative p-16 border-r border-border-neutral-base-component last:border-r-0',
        month_caption:
          'flex items-center justify-center mb-8 px-4 relative h-32 bg-background-field-base rounded-8 shadow-tooltip',
        caption_label: 'text-sm font-medium text-foreground-neutral-base',
        nav: 'flex items-center gap-4 fixed left-0 top-16 w-full z-10',
        button_previous: cn(
          'size-32 bg-transparent p-0 absolute left-16 top-0 cursor-pointer',
          'inline-flex items-center justify-center rounded-6',
          'text-foreground-neutral-muted',
          'hover:bg-transparent hover:text-foreground-neutral-subtle',
          'active:bg-transparent',
          'transition-colors outline-none',
          'focus-visible:shadow-border-interactive-with-active',
          'disabled:pointer-events-none disabled:opacity-50',
        ),
        button_next: cn(
          'size-32 bg-transparent p-0 absolute right-16 top-0 cursor-pointer',
          'inline-flex items-center justify-center rounded-6',
          'text-foreground-neutral-muted',
          'hover:bg-transparent hover:text-foreground-neutral-subtle',
          'active:bg-transparent',
          'transition-colors outline-none',
          'focus-visible:shadow-border-interactive-with-active',
          'disabled:pointer-events-none disabled:opacity-50',
        ),
        month_grid: 'w-full border-collapse mt-8',
        weekdays: 'flex gap-8',
        weekday:
          'text-foreground-neutral-subtle text-xs font-medium w-36 h-32 flex items-center justify-center',
        week: 'flex mt-8 gap-8',
        day: cn(
          'relative text-center size-36 p-0 text-sm font-normal [&:last-child[data-selected=true]_button]:rounded-r-md group/day aspect-square select-none',
          '[&:last-child[data-selected=true]_button]:rounded-r-6',
          props.showWeekNumber
            ? '[&:nth-child(2)[data-selected=true]_button]:rounded-l-6'
            : '[&:first-child[data-selected=true]_button]:rounded-l-6',
        ),
        day_button: cn(
          'size-36 p-0 text-sm font-normal rounded-6',
          'inline-flex items-center justify-center',
          'hover:bg-background-button-transparent-hover',
          'focus-visible:shadow-border-interactive-with-active',
          'transition-colors outline-none',
          'aria-selected:opacity-100',
        ),
        range_start: 'day-range-start rounded-6',
        range_end: 'day-range-end rounded-6',
        selected: cn(
          'bg-foreground-highlight-interactive/80 !text-foreground-neutral-on-inverted font-medium rounded-6',
          'hover:bg-foreground-highlight-interactive-hover/80',
          'focus:bg-foreground-highlight-interactive/80',
        ),
        today: cn(
          'relative font-medium rounded-6',
          'after:absolute after:bottom-[6px] after:left-1/2 after:-translate-x-1/2',
          'after:size-[3px] after:rounded-full after:bg-[var(--color-primary-400)]',
        ),
        outside: 'day-outside text-foreground-neutral-muted',
        disabled: 'text-foreground-neutral-disabled opacity-30 cursor-not-allowed',
        range_middle: cn(
          'aria-selected:bg-background-highlight-base aria-selected:!text-foreground-highlight-interactive',
        ),
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({orientation}) => {
          const iconName = orientation === 'left' ? 'arrowLeftSFill' : 'arrowRightSFill';
          return <Icon name={iconName} className="size-20" />;
        },
      }}
      {...props}
    />
  );
}
