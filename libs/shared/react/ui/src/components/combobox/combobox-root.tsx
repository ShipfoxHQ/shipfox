'use client';

import * as React from 'react';
import {Popover} from '../popover/index.js';
import {ComboboxContext, type ComboboxContextValue, comboboxOptionId} from './combobox-context.js';
import {
  type ComboboxOption,
  clearMultiComboboxValues,
  filterComboboxOptions,
  getNextActiveComboboxValue,
  removeMultiComboboxValue,
  resolveComboboxLabel,
  toggleMultiComboboxValue,
  toggleSingleComboboxValue,
} from './combobox-state.js';

type ComboboxRootBaseProps = {
  options: ComboboxOption[];
  children: React.ReactNode;
  disabled?: boolean;
  isLoading?: boolean;
  maxVisibleChips?: number;
};

type SingleControlledComboboxRootProps = ComboboxRootBaseProps & {
  multiple?: false;
  value: string;
  defaultValue?: never;
  onValueChange?: (value: string) => void;
};

type SingleUncontrolledComboboxRootProps = ComboboxRootBaseProps & {
  multiple?: false;
  value?: never;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

type MultiControlledComboboxRootProps = ComboboxRootBaseProps & {
  multiple: true;
  value: string[];
  defaultValue?: never;
  onValueChange?: (value: string[]) => void;
};

type MultiUncontrolledComboboxRootProps = ComboboxRootBaseProps & {
  multiple: true;
  value?: never;
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
};

export type ComboboxRootProps =
  | SingleControlledComboboxRootProps
  | SingleUncontrolledComboboxRootProps
  | MultiControlledComboboxRootProps
  | MultiUncontrolledComboboxRootProps;

export function ComboboxRoot(props: ComboboxRootProps) {
  const {options, children, disabled = false, isLoading = false, maxVisibleChips} = props;
  const multiple = props.multiple === true;
  const propsRef = React.useRef(props);
  propsRef.current = props;
  const listId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [searchValue, setSearchValue] = React.useState('');
  const [activeValue, setActiveValue] = React.useState<string | null>(null);
  const [internalSingleValue, setInternalSingleValue] = React.useState(
    !multiple ? (props.defaultValue ?? '') : '',
  );
  const [internalMultiValue, setInternalMultiValue] = React.useState(
    multiple ? (props.defaultValue ?? []) : [],
  );
  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!disabled) {
        setOpen(nextOpen);
      }
    },
    [disabled],
  );

  const selectedValue = multiple
    ? ''
    : ((props as SingleControlledComboboxRootProps | SingleUncontrolledComboboxRootProps).value ??
      internalSingleValue);
  const controlledMultiValue = multiple
    ? (props as MultiControlledComboboxRootProps | MultiUncontrolledComboboxRootProps).value
    : undefined;
  const selectedValues = React.useMemo<string[]>(
    () =>
      multiple
        ? (controlledMultiValue ?? internalMultiValue)
        : selectedValue
          ? [selectedValue]
          : [],
    [multiple, controlledMultiValue, internalMultiValue, selectedValue],
  );

  const visibleOptions = React.useMemo(
    () => filterComboboxOptions(options, searchValue),
    [options, searchValue],
  );

  const updateSingleValue = React.useCallback(
    (nextValue: string) => {
      const singleProps = propsRef.current as
        | SingleControlledComboboxRootProps
        | SingleUncontrolledComboboxRootProps;

      if (!multiple && singleProps.value === undefined) {
        setInternalSingleValue(nextValue);
      }
      if (!multiple) {
        singleProps.onValueChange?.(nextValue);
      }
    },
    [multiple],
  );

  const updateMultiValue = React.useCallback(
    (nextValues: string[]) => {
      const multiProps = propsRef.current as
        | MultiControlledComboboxRootProps
        | MultiUncontrolledComboboxRootProps;

      if (multiple && multiProps.value === undefined) {
        setInternalMultiValue(nextValues);
      }
      if (multiple) {
        multiProps.onValueChange?.(nextValues);
      }
    },
    [multiple],
  );

  const getLabel = React.useCallback(
    (value: string) => resolveComboboxLabel(options, value),
    [options],
  );

  const isSelected = React.useCallback(
    (value: string) => (multiple ? selectedValues.includes(value) : selectedValue === value),
    [multiple, selectedValue, selectedValues],
  );

  const selectValue = React.useCallback(
    (value: string) => {
      if (disabled) {
        return;
      }

      if (multiple) {
        updateMultiValue(toggleMultiComboboxValue(selectedValues, value));
        setSearchValue('');
        return;
      }

      updateSingleValue(toggleSingleComboboxValue(selectedValue, value));
      setSearchValue('');
      setOpen(false);
    },
    [disabled, multiple, selectedValue, selectedValues, updateMultiValue, updateSingleValue],
  );

  const removeValue = React.useCallback(
    (value: string) => {
      if (disabled || !multiple) {
        return;
      }
      updateMultiValue(removeMultiComboboxValue(selectedValues, value));
    },
    [disabled, multiple, selectedValues, updateMultiValue],
  );

  const removeLastValue = React.useCallback(() => {
    if (disabled || !multiple || selectedValues.length === 0) {
      return;
    }
    updateMultiValue(selectedValues.slice(0, -1));
  }, [disabled, multiple, selectedValues, updateMultiValue]);

  const clearValues = React.useCallback(() => {
    if (disabled || !multiple) {
      return;
    }
    updateMultiValue(clearMultiComboboxValues());
  }, [disabled, multiple, updateMultiValue]);

  const onListKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const values = visibleOptions.map((option) => option.value);

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          if (!open) {
            setOpen(true);
            return;
          }
          setActiveValue(getNextActiveComboboxValue(values, activeValue, 1));
          return;
        case 'ArrowUp':
          event.preventDefault();
          if (!open) {
            setOpen(true);
            return;
          }
          setActiveValue(getNextActiveComboboxValue(values, activeValue, -1));
          return;
        case 'Home':
          // Leave Home/End to the text caret while there is a query to navigate.
          if (open && searchValue === '') {
            event.preventDefault();
            setActiveValue(values[0] ?? null);
          }
          return;
        case 'End':
          if (open && searchValue === '') {
            event.preventDefault();
            setActiveValue(values.at(-1) ?? null);
          }
          return;
        case 'Enter':
          // Swallow Enter while open so it selects (when an option is active) and
          // never submits an enclosing form, even with an empty result list.
          if (open) {
            event.preventDefault();
            if (activeValue !== null) {
              selectValue(activeValue);
            }
          }
          return;
        case 'Escape':
          if (open) {
            event.preventDefault();
            setOpen(false);
          }
          return;
        default:
      }
    },
    [open, searchValue, activeValue, visibleOptions, selectValue],
  );

  // Keep the active option valid. Preserve the user's highlight as long as it still
  // matches the filter (so arrow position survives unrelated re-renders, even when the
  // consumer passes a fresh `options` array); otherwise fall back to the first match.
  // The functional updater intentionally avoids depending on `activeValue` so a stable
  // result bails out instead of looping.
  React.useEffect(() => {
    setActiveValue((current) =>
      open
        ? current !== null && visibleOptions.some((option) => option.value === current)
          ? current
          : (visibleOptions[0]?.value ?? null)
        : null,
    );
  }, [open, visibleOptions]);

  // Focus stays on the input, so the browser will not scroll the active option into
  // view on its own; do it ourselves. `nearest` is a no-op when it is already visible.
  React.useEffect(() => {
    if (!open || activeValue === null) {
      return;
    }
    document.getElementById(comboboxOptionId(listId, activeValue))?.scrollIntoView({
      block: 'nearest',
    });
  }, [open, activeValue, listId]);

  const contextValue = React.useMemo<ComboboxContextValue>(
    () => ({
      options,
      multiple,
      disabled,
      isLoading,
      maxVisibleChips,
      listId,
      open,
      setOpen,
      searchValue,
      setSearchValue,
      visibleOptions,
      activeValue,
      setActiveValue,
      selectedValue,
      selectedValues,
      getLabel,
      isSelected,
      selectValue,
      removeValue,
      removeLastValue,
      clearValues,
      onListKeyDown,
    }),
    [
      options,
      multiple,
      disabled,
      isLoading,
      maxVisibleChips,
      listId,
      open,
      searchValue,
      visibleOptions,
      activeValue,
      selectedValue,
      selectedValues,
      getLabel,
      isSelected,
      selectValue,
      removeValue,
      removeLastValue,
      clearValues,
      onListKeyDown,
    ],
  );

  return (
    <ComboboxContext.Provider value={contextValue}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        {children}
      </Popover>
    </ComboboxContext.Provider>
  );
}
