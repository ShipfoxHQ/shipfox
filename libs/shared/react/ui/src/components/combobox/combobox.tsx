'use client';

import * as React from 'react';
import {cn} from '#utils/cn.js';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandTrigger,
  type CommandTriggerProps,
} from '../command';
import {Icon} from '../icon';
import {Popover, PopoverContent, PopoverTrigger} from '../popover';
import {ScrollArea} from '../scroll-area/index.js';

export type ComboboxOption = {
  value: string;
  label: string;
};

export type ComboboxProps = Omit<CommandTriggerProps, 'children' | 'placeholder'> & {
  options: ComboboxOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  emptyState?: string | React.ReactNode;
  searchPlaceholder?: string;
  className?: string;
  popoverClassName?: string;
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  isLoading?: boolean;
};

export function Combobox({
  options,
  value,
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
  ...triggerProps
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [internalValue, setInternalValue] = React.useState('');

  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : internalValue;

  const handleValueChange = React.useCallback(
    (newValue: string) => {
      if (!isControlled) {
        setInternalValue(newValue);
      }
      onValueChange?.(newValue);
    },
    [isControlled, onValueChange],
  );

  const selectedOption = options.find((option) => option.value === currentValue);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <CommandTrigger
          variant={variant}
          size={size}
          placeholder={placeholder}
          className={className}
          isLoading={isLoading}
          {...triggerProps}
        >
          {selectedOption?.label}
        </CommandTrigger>
      </PopoverTrigger>
      <PopoverContent
        className={cn('w-(--radix-popover-trigger-width) p-0', popoverClassName)}
        align={align}
        sideOffset={sideOffset}
        onWheel={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <ScrollArea>
            <CommandList className="max-h-300">
              <CommandEmpty>{emptyState}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={(selectedValue) => {
                      handleValueChange(currentValue === selectedValue ? '' : selectedValue);
                      setOpen(false);
                    }}
                  >
                    <Icon
                      name="check"
                      className={cn(
                        'size-16 mr-8',
                        currentValue === option.value ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </ScrollArea>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
