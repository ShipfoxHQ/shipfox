'use client';

import {cva, type VariantProps} from 'class-variance-authority';
import {addDays, differenceInDays, format} from 'date-fns';
import type {ComponentProps, MouseEvent, ReactNode} from 'react';
import {useMemo, useState} from 'react';
import type {DateRange as DayPickerDateRange} from 'react-day-picker';
import {Calendar} from '#components/calendar/index.js';
import {Icon} from '#components/icon/index.js';
import {Popover, PopoverContent, PopoverTrigger} from '#components/popover/index.js';
import {cn} from '#utils/cn.js';

export const dateTimeRangePickerVariants = cva(
  'min-w-240 relative flex items-center rounded-6 shadow-button-neutral transition-[background-color,box-shadow] outline-none',
  {
    variants: {
      variant: {
        base: 'bg-background-field-base hover:bg-background-field-hover',
        component: 'bg-background-field-component hover:bg-background-field-component-hover',
      },
      size: {
        base: 'h-32',
        small: 'h-28',
      },
      state: {
        default: '',
        error: 'shadow-border-error',
        disabled:
          'bg-background-neutral-disabled shadow-none pointer-events-none cursor-not-allowed',
      },
    },
    defaultVariants: {
      variant: 'base',
      size: 'base',
      state: 'default',
    },
  },
);

export type DateRange = {
  start?: Date | undefined;
  end?: Date | undefined;
};

export type DateTimeRangePickerProps = Omit<ComponentProps<'input'>, 'size' | 'type'> &
  VariantProps<typeof dateTimeRangePickerVariants> & {
    dateRange?: DateRange;
    onDateRangeSelect?: (range: DateRange | undefined) => void;
    placeholder?: string;
    dateFormat?: string;
    leftIcon?: ReactNode;
    rightIcon?: ReactNode;
    onClear?: () => void;
    numberOfMonths?: number;
    closeOnSelect?: boolean;
    maxRangeDays?: number;
  };

export function DateTimeRangePicker({
  className,
  variant,
  size,
  state,
  dateRange,
  onDateRangeSelect,
  placeholder = 'DD/MM/YYYY - DD/MM/YYYY',
  dateFormat = 'dd/MM/yyyy',
  leftIcon,
  rightIcon,
  onClear,
  disabled,
  numberOfMonths = 2,
  closeOnSelect = false,
  maxRangeDays,
  ref,
  ...props
}: DateTimeRangePickerProps) {
  const [open, setOpen] = useState(false);

  const isDisabled = disabled || state === 'disabled';
  const startDate = dateRange?.start;
  const endDate = dateRange?.end;
  const hasRange = Boolean(startDate && endDate);

  const displayValue =
    hasRange && startDate && endDate
      ? `${format(startDate, dateFormat)} - ${format(endDate, dateFormat)}`
      : '';

  const dayPickerRange: DayPickerDateRange | undefined =
    startDate || endDate ? {from: startDate, to: endDate} : undefined;

  const defaultMonth = startDate ?? new Date();

  const disabledDates = useMemo(() => {
    if (!startDate || maxRangeDays === undefined) return undefined;

    return (date: Date) => differenceInDays(date, startDate) > maxRangeDays;
  }, [startDate, maxRangeDays]);

  const handleSelect = (selectedRange: DayPickerDateRange | undefined) => {
    if (!selectedRange) {
      onDateRangeSelect?.(undefined);
      return;
    }

    const {from, to} = selectedRange;
    let finalEndDate = to;

    if (from && to && maxRangeDays !== undefined && differenceInDays(to, from) > maxRangeDays) {
      finalEndDate = addDays(from, maxRangeDays);
    }

    onDateRangeSelect?.({start: from, end: finalEndDate});

    if (closeOnSelect && from && finalEndDate) {
      setOpen(false);
    }
  };

  const handleClear = (event: MouseEvent) => {
    event.stopPropagation();
    onClear?.();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          open && 'shadow-border-interactive-with-active',
          dateTimeRangePickerVariants({variant, size, state: isDisabled ? 'disabled' : state}),
          className,
        )}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isDisabled}
            className={cn(
              'flex items-center justify-center shrink-0 transition-colors',
              size === 'small' ? 'size-28' : 'size-32',
              isDisabled && 'text-foreground-neutral-disabled',
            )}
            aria-label="Open calendar"
          >
            {leftIcon || (
              <Icon
                name="calendar2Line"
                className={cn(
                  'size-16 text-foreground-neutral-muted',
                  isDisabled && 'text-foreground-neutral-disabled',
                )}
              />
            )}
          </button>
        </PopoverTrigger>

        <div className="h-full w-px bg-border-neutral-base shrink-0" />

        <input
          ref={ref}
          type="text"
          disabled={isDisabled}
          placeholder={placeholder}
          value={displayValue}
          readOnly
          className={cn(
            'flex-1 min-w-0 px-8 text-sm leading-20 bg-transparent outline-none border-none cursor-pointer',
            'placeholder:text-foreground-neutral-muted',
            'text-foreground-neutral-base',
            'disabled:text-foreground-neutral-disabled disabled:cursor-not-allowed',
            size === 'small' ? 'py-4' : 'py-6',
          )}
          onClick={() => !isDisabled && setOpen(true)}
          {...props}
        />

        <button
          type="button"
          onClick={handleClear}
          className={cn(
            'flex items-center justify-center shrink-0 transition-colors hover:text-foreground-neutral-base cursor-pointer',
            size === 'small' ? 'size-28' : 'size-32',
            hasRange && onClear && !isDisabled ? 'visible' : 'invisible',
          )}
          aria-label="Clear date range"
        >
          <Icon
            name="closeLine"
            className="size-16 text-foreground-neutral-muted hover:text-foreground-neutral-subtle transition-colors"
          />
        </button>

        {rightIcon && !hasRange && (
          <div
            className={cn(
              'flex items-center justify-center shrink-0',
              size === 'small' ? 'size-28' : 'size-32',
            )}
          >
            {rightIcon}
          </div>
        )}
      </div>

      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          defaultMonth={defaultMonth}
          selected={dayPickerRange}
          onSelect={handleSelect}
          numberOfMonths={numberOfMonths}
          disabled={disabledDates}
          formatters={{
            formatWeekdayName: (date) => format(date, 'EEEEE'),
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
