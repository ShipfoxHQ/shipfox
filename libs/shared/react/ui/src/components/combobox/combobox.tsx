'use client';

import type * as React from 'react';
import type {CommandTriggerProps} from '../command/index.js';
import {ComboboxContent, ComboboxInput, ComboboxList} from './combobox-content.js';
import {ComboboxRoot} from './combobox-root.js';
import type {ComboboxOption} from './combobox-state.js';
import {ComboboxTrigger} from './combobox-trigger.js';

export type {ComboboxOption};

type ComboboxTriggerPassthroughProps = Omit<
  CommandTriggerProps,
  'children' | 'placeholder' | 'value' | 'defaultValue' | 'onChange'
>;

type ComboboxBaseProps = ComboboxTriggerPassthroughProps & {
  options: ComboboxOption[];
  placeholder?: string;
  emptyState?: string | React.ReactNode;
  searchPlaceholder?: string;
  className?: string;
  popoverClassName?: string;
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  isLoading?: boolean;
  maxVisibleChips?: number;
};

type SingleControlledComboboxProps = ComboboxBaseProps & {
  multiple?: false;
  value: string;
  defaultValue?: never;
  onValueChange?: (value: string) => void;
};

type SingleUncontrolledComboboxProps = ComboboxBaseProps & {
  multiple?: false;
  value?: never;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

type MultiControlledComboboxProps = ComboboxBaseProps & {
  multiple: true;
  value: string[];
  defaultValue?: never;
  onValueChange?: (value: string[]) => void;
};

type MultiUncontrolledComboboxProps = ComboboxBaseProps & {
  multiple: true;
  value?: never;
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
};

export type ComboboxProps =
  | SingleControlledComboboxProps
  | SingleUncontrolledComboboxProps
  | MultiControlledComboboxProps
  | MultiUncontrolledComboboxProps;

export function Combobox({
  options,
  multiple,
  value,
  defaultValue,
  onValueChange,
  placeholder = 'Select option...',
  emptyState = 'No option found.',
  searchPlaceholder = 'Search...',
  className,
  popoverClassName,
  align = 'start',
  sideOffset = 4,
  variant,
  size,
  isLoading = false,
  disabled = false,
  maxVisibleChips,
  ...triggerProps
}: ComboboxProps) {
  const children = (
    <>
      <ComboboxTrigger
        variant={variant}
        size={size}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        {...triggerProps}
      />
      <ComboboxContent className={popoverClassName} align={align} sideOffset={sideOffset}>
        {!multiple && <ComboboxInput placeholder={searchPlaceholder} />}
        <ComboboxList emptyState={emptyState} />
      </ComboboxContent>
    </>
  );

  const rootBaseProps = {
    options,
    disabled,
    isLoading,
    children,
    ...(maxVisibleChips === undefined ? {} : {maxVisibleChips}),
  };

  if (multiple) {
    const multiValueChangeProps = onValueChange === undefined ? {} : {onValueChange};

    if (value !== undefined) {
      return <ComboboxRoot {...rootBaseProps} multiple value={value} {...multiValueChangeProps} />;
    }

    const multiDefaultValueProps = defaultValue === undefined ? {} : {defaultValue};

    return (
      <ComboboxRoot
        {...rootBaseProps}
        multiple
        {...multiDefaultValueProps}
        {...multiValueChangeProps}
      />
    );
  }

  const singleValueChangeProps = onValueChange === undefined ? {} : {onValueChange};

  if (value !== undefined) {
    return <ComboboxRoot {...rootBaseProps} value={value} {...singleValueChangeProps} />;
  }

  const singleDefaultValueProps = defaultValue === undefined ? {} : {defaultValue};

  return (
    <ComboboxRoot {...rootBaseProps} {...singleDefaultValueProps} {...singleValueChangeProps} />
  );
}
