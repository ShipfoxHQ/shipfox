'use client';

import type * as React from 'react';
import {cn} from '#utils/cn.js';
import {
  CommandTrigger,
  type CommandTriggerProps,
  commandTriggerVariants,
} from '../command/index.js';
import {Icon} from '../icon/index.js';
import {PopoverTrigger} from '../popover/index.js';
import {activeDescendantId, useComboboxContext} from './combobox-context.js';
import {partitionComboboxChipsByCount} from './combobox-state.js';

export type ComboboxTriggerProps = Omit<CommandTriggerProps, 'children' | 'placeholder'> & {
  children?: React.ReactNode;
  placeholder?: string;
};

export function ComboboxTrigger({
  children,
  placeholder = 'Select option...',
  className,
  variant,
  size,
  disabled,
  onClick,
  onKeyDown,
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  ...props
}: ComboboxTriggerProps) {
  const context = useComboboxContext();
  const isDisabled = disabled || context.disabled;
  // Route the label/name onto the labelable widget: the <button> for single-select,
  // the inline <input> for multi-select. The multi wrapper is a presentational <div>,
  // which `htmlFor` cannot name, so the input must carry id/aria-* instead.
  const labelProps = {
    id,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledby,
    'aria-describedby': ariaDescribedby,
  };

  if (!context.multiple) {
    const triggerContent = children ?? (context.selectedValue ? <ComboboxValue /> : undefined);

    return (
      <PopoverTrigger asChild>
        <CommandTrigger
          variant={variant}
          size={size}
          placeholder={placeholder}
          className={className}
          disabled={isDisabled}
          isLoading={context.isLoading}
          onClick={onClick}
          onKeyDown={onKeyDown}
          {...labelProps}
          {...props}
        >
          {triggerContent}
        </CommandTrigger>
      </PopoverTrigger>
    );
  }

  const triggerContent = children ?? (
    <ComboboxValue placeholder={placeholder} inputProps={labelProps} />
  );

  return (
    <PopoverTrigger asChild>
      <div
        data-slot="combobox-trigger"
        data-disabled={isDisabled || undefined}
        className={cn(
          commandTriggerVariants({variant, size}),
          size === 'small' ? 'min-h-28' : 'min-h-32',
          'h-auto cursor-text items-start py-4',
          'data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:bg-background-neutral-disabled data-disabled:shadow-none data-disabled:text-foreground-neutral-disabled',
          className,
        )}
        {...(props as Omit<React.ComponentProps<'div'>, 'onClick' | 'onKeyDown'>)}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4 text-left">
          {triggerContent}
        </div>
        <div className="mt-2 flex shrink-0 items-center gap-4">
          {context.selectedValues.length > 1 && (
            <button
              type="button"
              aria-label="Clear selected options"
              disabled={isDisabled}
              className={cn(
                'inline-flex size-16 shrink-0 items-center justify-center rounded-4',
                'text-foreground-neutral-muted transition-colors hover:text-foreground-neutral-base',
                'focus-visible:shadow-border-interactive-with-active outline-none',
                'disabled:pointer-events-none disabled:text-foreground-neutral-disabled',
              )}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                context.clearValues();
              }}
            >
              <Icon name="closeLine" className="size-14" />
            </button>
          )}
          {context.isLoading ? (
            <Icon name="spinner" className="size-16 text-foreground-neutral-base" />
          ) : (
            <Icon name="expandUpDownLine" className="size-16 text-foreground-neutral-muted" />
          )}
        </div>
      </div>
    </PopoverTrigger>
  );
}

type ComboboxValueProps = {
  placeholder?: string;
  inputProps?: ComboboxChipsInputProps;
};

export function ComboboxValue({placeholder = 'Select option...', inputProps}: ComboboxValueProps) {
  const context = useComboboxContext();

  if (context.multiple) {
    return (
      <>
        <ComboboxChips />
        <ComboboxChipsInput placeholder={placeholder} {...inputProps} />
      </>
    );
  }

  if (!context.selectedValue) {
    return null;
  }

  return context.getLabel(context.selectedValue);
}

const chipClassName = cn(
  'inline-flex h-20 max-w-160 items-center gap-4 rounded-4 border border-tag-neutral-border',
  'bg-tag-neutral-bg px-6 text-xs font-medium leading-20 text-tag-neutral-text',
);

const chipTrailingClassName = 'inline-flex size-12 shrink-0 items-center justify-center rounded-2';

const overflowBadgeClassName = cn(chipClassName, 'max-w-none shrink-0');

type ComboboxChipsProps = React.ComponentProps<'div'>;

export function ComboboxChips({className, ...props}: ComboboxChipsProps) {
  const context = useComboboxContext();

  if (context.selectedValues.length === 0) {
    return null;
  }

  // Default: show every chip and let the field grow/wrap. A numeric `maxVisibleChips`
  // collapses the remainder into a "+N" summary for a compact, fixed-row layout.
  const {visibleValues, hiddenCount} =
    context.maxVisibleChips === undefined
      ? {visibleValues: context.selectedValues, hiddenCount: 0}
      : partitionComboboxChipsByCount(context.selectedValues, context.maxVisibleChips);

  return (
    <div
      data-slot="combobox-chips"
      className={cn('flex min-w-0 flex-wrap items-center gap-4', className)}
      {...props}
    >
      {visibleValues.map((value) => (
        <ComboboxChip key={value} value={value} />
      ))}
      {hiddenCount > 0 && (
        <span
          role="img"
          className={overflowBadgeClassName}
          aria-label={`${hiddenCount} more selected`}
        >
          +{hiddenCount}
        </span>
      )}
    </div>
  );
}

type ComboboxChipProps = React.ComponentProps<'span'> & {
  value: string;
};

export function ComboboxChip({value, className, ...props}: ComboboxChipProps) {
  const context = useComboboxContext();
  const label = context.getLabel(value);

  return (
    <span data-slot="combobox-chip" className={cn(chipClassName, className)} {...props}>
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        disabled={context.disabled}
        className={cn(
          chipTrailingClassName,
          'text-tag-neutral-icon transition-colors hover:opacity-70',
          'focus-visible:shadow-border-interactive-with-active outline-none',
          'disabled:pointer-events-none disabled:text-foreground-neutral-disabled',
        )}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          context.removeValue(value);
        }}
      >
        <Icon name="closeLine" className="size-12" />
      </button>
    </span>
  );
}

type ComboboxChipsInputProps = Omit<React.ComponentProps<'input'>, 'value' | 'onChange'>;

export function ComboboxChipsInput({
  className,
  placeholder,
  onKeyDown,
  ...props
}: ComboboxChipsInputProps) {
  const context = useComboboxContext();

  return (
    <input
      role="combobox"
      aria-expanded={context.open}
      aria-controls={context.listId}
      aria-haspopup="listbox"
      aria-autocomplete="list"
      aria-activedescendant={activeDescendantId(context.listId, context.activeValue)}
      value={context.searchValue}
      placeholder={context.selectedValues.length === 0 ? placeholder : undefined}
      disabled={context.disabled}
      className={cn(
        'min-w-80 flex-1 bg-transparent text-sm leading-20 outline-none',
        'placeholder:text-foreground-neutral-muted',
        'disabled:cursor-not-allowed disabled:text-foreground-neutral-disabled',
        className,
      )}
      onChange={(event) => {
        context.setSearchValue(event.target.value);
        context.setOpen(true);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) {
          return;
        }

        // Backspace on an empty query removes the last chip; everything else
        // (arrows / Enter / Home / End / Escape) is shared list navigation.
        if (event.key === 'Backspace' && context.searchValue === '') {
          context.removeLastValue();
          return;
        }

        context.onListKeyDown(event);
      }}
      {...props}
    />
  );
}
