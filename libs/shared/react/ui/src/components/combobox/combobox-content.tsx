'use client';

import type * as React from 'react';
import {cn} from '#utils/cn.js';
import {Icon} from '../icon/index.js';
import {PopoverContent} from '../popover/index.js';
import {activeDescendantId, comboboxOptionId, useComboboxContext} from './combobox-context.js';
import type {ComboboxOption} from './combobox-state.js';

type ComboboxContentProps = React.ComponentProps<typeof PopoverContent>;

export function ComboboxContent({
  className,
  align = 'start',
  sideOffset = 4,
  children,
  ...props
}: ComboboxContentProps) {
  const context = useComboboxContext();
  return (
    <PopoverContent
      className={cn('w-(--radix-popover-trigger-width) p-0', className)}
      align={align}
      sideOffset={sideOffset}
      // Multi-select types in the trigger's inline combobox input, so keep focus there
      // instead of letting the popover steal it on open.
      onOpenAutoFocus={context.multiple ? (event) => event.preventDefault() : undefined}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      {...props}
    >
      {children}
    </PopoverContent>
  );
}

type ComboboxInputProps = Omit<React.ComponentProps<'input'>, 'value' | 'onChange'>;

export function ComboboxInput({className, onKeyDown, ...props}: ComboboxInputProps) {
  const context = useComboboxContext();

  return (
    <div className="flex items-center gap-8 border-b border-border-neutral-strong p-8">
      <Icon name="searchLine" className="size-16 shrink-0 text-foreground-neutral-muted" />
      <input
        role="combobox"
        aria-expanded={context.open}
        aria-controls={context.listId}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-activedescendant={activeDescendantId(context.listId, context.activeValue)}
        value={context.searchValue}
        disabled={context.disabled}
        className={cn(
          'flex-1 bg-transparent text-sm leading-20 outline-none',
          'placeholder:text-foreground-neutral-muted',
          'disabled:cursor-not-allowed disabled:text-foreground-neutral-disabled',
          className,
        )}
        onChange={(event) => context.setSearchValue(event.target.value)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented) {
            context.onListKeyDown(event);
          }
        }}
        {...props}
      />
    </div>
  );
}

type ComboboxEmptyProps = React.ComponentProps<'div'>;

export function ComboboxEmpty({className, ...props}: ComboboxEmptyProps) {
  return (
    <div
      className={cn('py-24 text-center text-sm text-foreground-neutral-muted', className)}
      {...props}
    />
  );
}

type ComboboxListProps = React.ComponentProps<'div'> & {
  emptyState?: React.ReactNode;
};

export function ComboboxList({
  children,
  emptyState = 'No option found.',
  className,
  ...props
}: ComboboxListProps) {
  const context = useComboboxContext();

  return (
    <div
      role="listbox"
      id={context.listId}
      aria-multiselectable={context.multiple || undefined}
      className={cn('max-h-300 overflow-y-auto overflow-x-hidden p-4 scrollbar', className)}
      {...props}
    >
      {children ??
        (context.visibleOptions.length > 0 ? (
          context.visibleOptions.map((option) => (
            <ComboboxItem key={option.value} option={option} />
          ))
        ) : (
          <ComboboxEmpty>{emptyState}</ComboboxEmpty>
        ))}
    </div>
  );
}

const optionClassName = cn(
  'relative flex cursor-pointer select-none items-center gap-8 rounded-6 px-8 py-6',
  'text-sm leading-20 text-foreground-neutral-subtle outline-none transition-colors',
  'data-[active=true]:bg-background-components-hover data-[active=true]:text-foreground-neutral-base',
  'aria-disabled:pointer-events-none aria-disabled:text-foreground-neutral-disabled',
);

type ComboboxItemBaseProps = Omit<React.ComponentProps<'div'>, 'onSelect'> & {
  disabled?: boolean;
  onSelect?: (value: string) => void;
};

type ComboboxItemProps =
  | (ComboboxItemBaseProps & {
      option: ComboboxOption;
      value?: never;
    })
  | (ComboboxItemBaseProps & {
      option?: never;
      value: string;
    });

export function ComboboxItem({
  option,
  value,
  children,
  className,
  disabled,
  onSelect,
  ...props
}: ComboboxItemProps) {
  const context = useComboboxContext();
  const itemValue = option ? option.value : value;
  const label =
    option?.label ?? (typeof children === 'string' ? children : context.getLabel(itemValue));
  const selected = context.isSelected(itemValue);
  const active = context.activeValue === itemValue;
  const isDisabled = Boolean(disabled) || context.disabled;

  return (
    // Options follow the aria-activedescendant model: focus stays on the combobox
    // input (which owns all keyboard handling), and options are not Tab stops.
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard navigation lives on the combobox input
    <div
      role="option"
      id={comboboxOptionId(context.listId, itemValue)}
      tabIndex={-1}
      aria-selected={selected}
      aria-disabled={isDisabled || undefined}
      data-active={active || undefined}
      data-state={selected ? 'checked' : 'unchecked'}
      className={cn(optionClassName, className)}
      onPointerEnter={() => {
        if (!isDisabled) {
          context.setActiveValue(itemValue);
        }
      }}
      onClick={() => {
        if (isDisabled) {
          return;
        }
        context.selectValue(itemValue);
        onSelect?.(itemValue);
      }}
      {...props}
    >
      <Icon name="check" className={cn('size-16 mr-8', selected ? 'opacity-100' : 'opacity-0')} />
      {children ?? label}
    </div>
  );
}
