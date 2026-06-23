'use client';

import * as React from 'react';
import {cn} from '#utils/cn.js';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  type CommandInputProps,
  CommandItem,
  CommandList,
  CommandTrigger,
  type CommandTriggerProps,
  commandTriggerVariants,
} from '../command/index.js';
import {Icon} from '../icon/index.js';
import {Popover, PopoverContent, PopoverTrigger} from '../popover/index.js';
import {ScrollArea} from '../scroll-area/index.js';
import {
  type ComboboxOption,
  clearMultiComboboxValues,
  partitionComboboxChipsByCount,
  partitionComboboxChipsByWidth,
  removeMultiComboboxValue,
  resolveComboboxLabel,
  toggleMultiComboboxValue,
  toggleSingleComboboxValue,
} from './combobox-state.js';

export type {ComboboxOption};

type ComboboxRootBaseProps = {
  options: ComboboxOption[];
  children: React.ReactNode;
  disabled?: boolean;
  isLoading?: boolean;
  maxVisibleChips?: number | 'auto';
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

type ComboboxContextValue = {
  options: ComboboxOption[];
  multiple: boolean;
  disabled: boolean;
  isLoading: boolean;
  maxVisibleChips: number | 'auto';
  open: boolean;
  setOpen: (open: boolean) => void;
  searchValue: string;
  setSearchValue: (value: string) => void;
  selectedValue: string;
  selectedValues: string[];
  getLabel: (value: string) => string;
  isSelected: (value: string) => boolean;
  selectValue: (value: string) => void;
  removeValue: (value: string) => void;
  removeLastValue: () => void;
  clearValues: () => void;
};

const ComboboxContext = React.createContext<ComboboxContextValue | null>(null);

function useComboboxContext() {
  const context = React.useContext(ComboboxContext);
  if (!context) {
    throw new Error('Combobox components must be used within a ComboboxRoot.');
  }
  return context;
}

function ComboboxRoot(props: ComboboxRootProps) {
  const {options, children, disabled = false, isLoading = false, maxVisibleChips = 'auto'} = props;
  const multiple = props.multiple === true;
  const [open, setOpen] = React.useState(false);
  const [searchValue, setSearchValue] = React.useState('');
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
  const selectedValues = multiple
    ? ((props as MultiControlledComboboxRootProps | MultiUncontrolledComboboxRootProps).value ??
      internalMultiValue)
    : selectedValue
      ? [selectedValue]
      : [];

  const updateSingleValue = React.useCallback(
    (nextValue: string) => {
      const singleProps = props as
        | SingleControlledComboboxRootProps
        | SingleUncontrolledComboboxRootProps;

      if (!multiple && singleProps.value === undefined) {
        setInternalSingleValue(nextValue);
      }
      if (!multiple) {
        singleProps.onValueChange?.(nextValue);
      }
    },
    [multiple, props],
  );

  const updateMultiValue = React.useCallback(
    (nextValues: string[]) => {
      const multiProps = props as
        | MultiControlledComboboxRootProps
        | MultiUncontrolledComboboxRootProps;

      if (multiple && multiProps.value === undefined) {
        setInternalMultiValue(nextValues);
      }
      if (multiple) {
        multiProps.onValueChange?.(nextValues);
      }
    },
    [multiple, props],
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

  const contextValue = React.useMemo<ComboboxContextValue>(
    () => ({
      options,
      multiple,
      disabled,
      isLoading,
      maxVisibleChips,
      open,
      setOpen,
      searchValue,
      setSearchValue,
      selectedValue,
      selectedValues,
      getLabel,
      isSelected,
      selectValue,
      removeValue,
      removeLastValue,
      clearValues,
    }),
    [
      options,
      multiple,
      disabled,
      isLoading,
      maxVisibleChips,
      open,
      searchValue,
      selectedValue,
      selectedValues,
      getLabel,
      isSelected,
      selectValue,
      removeValue,
      removeLastValue,
      clearValues,
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

export type ComboboxTriggerProps = Omit<CommandTriggerProps, 'children' | 'placeholder'> & {
  children?: React.ReactNode;
  placeholder?: string;
};

function ComboboxTrigger({
  children,
  placeholder = 'Select option...',
  className,
  variant,
  size,
  disabled,
  onClick,
  onKeyDown,
  ...props
}: ComboboxTriggerProps) {
  const context = useComboboxContext();
  const isDisabled = disabled || context.disabled;

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
          {...props}
        >
          {triggerContent}
        </CommandTrigger>
      </PopoverTrigger>
    );
  }

  const triggerContent = children ?? <ComboboxValue placeholder={placeholder} />;

  return (
    <PopoverTrigger asChild>
      <div
        role="combobox"
        aria-expanded={context.open}
        aria-disabled={isDisabled || undefined}
        tabIndex={isDisabled ? -1 : 0}
        data-slot="combobox-trigger"
        data-disabled={isDisabled || undefined}
        className={cn(
          commandTriggerVariants({variant, size}),
          size === 'small' ? 'min-h-28' : 'min-h-32',
          'h-auto cursor-text items-start py-4',
          'data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:bg-background-neutral-disabled data-disabled:shadow-none data-disabled:text-foreground-neutral-disabled',
          className,
        )}
        onClick={(event) => {
          onClick?.(event as unknown as React.MouseEvent<HTMLButtonElement>);
          if (!event.defaultPrevented && !isDisabled) {
            context.setOpen(true);
          }
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event as unknown as React.KeyboardEvent<HTMLButtonElement>);
          if (event.defaultPrevented || isDisabled) {
            return;
          }

          if (
            event.target === event.currentTarget &&
            (event.key === 'Enter' || event.key === ' ')
          ) {
            event.preventDefault();
            context.setOpen(true);
          }
        }}
        {...(props as Omit<React.ComponentProps<'div'>, 'onClick' | 'onKeyDown'>)}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4 text-left">
          {triggerContent}
        </div>
        {context.isLoading ? (
          <Icon name="spinner" className="size-16 text-foreground-neutral-base shrink-0 mt-2" />
        ) : (
          <Icon
            name="expandUpDownLine"
            className="size-16 text-foreground-neutral-muted shrink-0 mt-2"
          />
        )}
      </div>
    </PopoverTrigger>
  );
}

type ComboboxValueProps = {
  placeholder?: string;
};

function ComboboxValue({placeholder = 'Select option...'}: ComboboxValueProps) {
  const context = useComboboxContext();

  if (context.multiple) {
    return (
      <>
        <ComboboxChips />
        <ComboboxChipsInput placeholder={placeholder} />
      </>
    );
  }

  if (!context.selectedValue) {
    return null;
  }

  return context.getLabel(context.selectedValue);
}

type ComboboxContentProps = React.ComponentProps<typeof PopoverContent>;

function ComboboxContent({
  className,
  align = 'start',
  sideOffset = 4,
  children,
  ...props
}: ComboboxContentProps) {
  return (
    <PopoverContent
      className={cn('w-(--radix-popover-trigger-width) p-0', className)}
      align={align}
      sideOffset={sideOffset}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      {...props}
    >
      <Command shouldFilter={false}>{children}</Command>
    </PopoverContent>
  );
}

function ComboboxInput(props: CommandInputProps) {
  const context = useComboboxContext();

  return (
    <CommandInput
      value={context.searchValue}
      onValueChange={context.setSearchValue}
      disabled={context.disabled}
      {...props}
    />
  );
}

type ComboboxEmptyProps = React.ComponentProps<typeof CommandEmpty>;

function ComboboxEmpty(props: ComboboxEmptyProps) {
  return <CommandEmpty {...props} />;
}

type ComboboxListProps = Omit<React.ComponentProps<typeof CommandList>, 'children'> & {
  children?: React.ReactNode;
  emptyState?: React.ReactNode;
};

function ComboboxList({
  children,
  emptyState = 'No option found.',
  className,
  ...props
}: ComboboxListProps) {
  const context = useComboboxContext();
  const filteredOptions = React.useMemo(() => {
    const normalizedSearch = context.searchValue.trim().toLowerCase();
    if (!normalizedSearch) {
      return context.options;
    }

    return context.options.filter(
      (option) =>
        option.label.toLowerCase().includes(normalizedSearch) ||
        option.value.toLowerCase().includes(normalizedSearch),
    );
  }, [context.options, context.searchValue]);

  return (
    <ScrollArea>
      <CommandList className={cn('max-h-300', className)} {...props}>
        {children ??
          (filteredOptions.length > 0 ? (
            <CommandGroup>
              {filteredOptions.map((option) => (
                <ComboboxItem key={option.value} option={option} />
              ))}
            </CommandGroup>
          ) : (
            <ComboboxEmpty>{emptyState}</ComboboxEmpty>
          ))}
      </CommandList>
    </ScrollArea>
  );
}

type ComboboxItemProps = Omit<React.ComponentProps<typeof CommandItem>, 'value' | 'onSelect'> & {
  option?: ComboboxOption;
  value?: string;
  onSelect?: (value: string) => void;
};

function ComboboxItem({
  option,
  value,
  children,
  className,
  disabled,
  onSelect,
  ...props
}: ComboboxItemProps) {
  const context = useComboboxContext();
  const itemValue = option?.value ?? value;

  if (!itemValue) {
    throw new Error('ComboboxItem requires either an option or a value.');
  }

  const label =
    option?.label ?? (typeof children === 'string' ? children : context.getLabel(itemValue));
  const selected = context.isSelected(itemValue);
  const isDisabled = disabled || context.disabled;

  return (
    <CommandItem
      value={itemValue}
      disabled={isDisabled}
      aria-checked={selected}
      data-state={selected ? 'checked' : 'unchecked'}
      className={className}
      onSelect={() => {
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
    </CommandItem>
  );
}

const chipClassName = cn(
  'inline-flex h-20 max-w-160 items-center gap-4 rounded-4 border border-tag-neutral-border',
  'bg-tag-neutral-bg px-6 text-xs font-medium leading-20 text-tag-neutral-text',
);

type ComboboxChipsProps = React.ComponentProps<'div'>;

function ComboboxChips({className, ...props}: ComboboxChipsProps) {
  const context = useComboboxContext();
  const {containerRef, measureNodes, overflowRef, visibleValues, hiddenCount} =
    useVisibleComboboxChips();

  if (context.selectedValues.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      data-slot="combobox-chips"
      className={cn('relative flex min-w-0 flex-wrap items-center gap-4', className)}
      {...props}
    >
      {visibleValues.map((value) => (
        <ComboboxChip key={value} value={value} />
      ))}
      {hiddenCount > 0 && (
        <span
          role="img"
          className={cn(chipClassName, 'max-w-none shrink-0')}
          aria-label={`${hiddenCount} more selected`}
        >
          +{hiddenCount}
        </span>
      )}
      {context.selectedValues.length > 1 && (
        <button
          type="button"
          aria-label="Clear selected options"
          disabled={context.disabled}
          className={cn(
            'inline-flex size-20 shrink-0 items-center justify-center rounded-4',
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
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-[9999px] top-0 flex items-center gap-4 opacity-0"
      >
        {context.selectedValues.map((value) => (
          <span
            key={value}
            ref={(node) => {
              measureNodes.current.set(value, node);
            }}
            className={chipClassName}
          >
            <span className="truncate">{context.getLabel(value)}</span>
            <Icon name="closeLine" className="size-12 shrink-0" />
          </span>
        ))}
        <span ref={overflowRef} className={cn(chipClassName, 'max-w-none shrink-0')}>
          +{context.selectedValues.length}
        </span>
      </div>
    </div>
  );
}

type ComboboxChipProps = React.ComponentProps<'span'> & {
  value: string;
};

function ComboboxChip({value, className, ...props}: ComboboxChipProps) {
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
          'inline-flex size-12 shrink-0 items-center justify-center rounded-2',
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

function ComboboxChipsInput({
  className,
  placeholder,
  onKeyDown,
  onFocus,
  ...props
}: ComboboxChipsInputProps) {
  const context = useComboboxContext();

  return (
    <input
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
      onFocus={(event) => {
        onFocus?.(event);
        if (!event.defaultPrevented) {
          context.setOpen(true);
        }
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) {
          return;
        }

        if (event.key === 'Backspace' && context.searchValue === '') {
          context.removeLastValue();
        }

        if (event.key === 'Escape') {
          context.setOpen(false);
        }
      }}
      {...props}
    />
  );
}

function useVisibleComboboxChips() {
  const context = useComboboxContext();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const measureNodes = React.useRef(new Map<string, HTMLSpanElement | null>());
  const overflowRef = React.useRef<HTMLSpanElement | null>(null);
  const [availableWidth, setAvailableWidth] = React.useState(0);
  const [measureVersion, setMeasureVersion] = React.useState(0);
  const selectedValuesKey = context.selectedValues.join('\u0000');

  React.useLayoutEffect(() => {
    if (context.maxVisibleChips !== 'auto') {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const measure = () => {
      setAvailableWidth(container.getBoundingClientRect().width);
      setMeasureVersion((version) => version + 1);
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(measure);
    observer.observe(container);

    return () => observer.disconnect();
  }, [context.maxVisibleChips]);

  React.useLayoutEffect(() => {
    void selectedValuesKey;
    setMeasureVersion((version) => version + 1);
  }, [selectedValuesKey]);

  const partition = React.useMemo(() => {
    void measureVersion;

    if (typeof context.maxVisibleChips === 'number') {
      return partitionComboboxChipsByCount(context.selectedValues, context.maxVisibleChips);
    }

    const overflowChipWidth = overflowRef.current?.getBoundingClientRect().width;
    if (!overflowChipWidth || !availableWidth) {
      return partitionComboboxChipsByCount(context.selectedValues, 2);
    }

    const valueWidths = new Map<string, number>();
    for (const value of context.selectedValues) {
      const width = measureNodes.current.get(value)?.getBoundingClientRect().width;
      if (!width) {
        return partitionComboboxChipsByCount(context.selectedValues, 2);
      }
      valueWidths.set(value, width);
    }

    return partitionComboboxChipsByWidth({
      values: context.selectedValues,
      valueWidths,
      availableWidth,
      overflowChipWidth,
      gapWidth: 4,
    });
  }, [availableWidth, context.maxVisibleChips, context.selectedValues, measureVersion]);

  return {
    containerRef,
    measureNodes,
    overflowRef,
    visibleValues: partition.visibleValues,
    hiddenCount: partition.hiddenCount,
  };
}

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
  maxVisibleChips?: number | 'auto';
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
  maxVisibleChips = 'auto',
  ...triggerProps
}: ComboboxProps) {
  const rootProps = {
    options,
    disabled,
    isLoading,
    maxVisibleChips,
    multiple,
    value,
    defaultValue,
    onValueChange,
  } as ComboboxRootProps;

  return (
    <ComboboxRoot {...rootProps}>
      <ComboboxTrigger
        variant={variant}
        size={size}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        {...triggerProps}
      />
      <ComboboxContent className={popoverClassName} align={align} sideOffset={sideOffset}>
        <ComboboxInput placeholder={searchPlaceholder} />
        <ComboboxList emptyState={emptyState} />
      </ComboboxContent>
    </ComboboxRoot>
  );
}

export {
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxValue,
};
