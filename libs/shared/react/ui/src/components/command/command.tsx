'use client';

import {cva, type VariantProps} from 'class-variance-authority';
import {Command as CommandPrimitive} from 'cmdk';
import {type ComponentProps, forwardRef, useCallback, useState} from 'react';
import {cn} from '#utils/cn.js';
import {Icon} from '../icon';
import {Kbd} from '../kbd';

const commandTriggerVariants = cva(
  [
    'flex items-center justify-between gap-8',
    'w-full rounded-6 px-8 text-sm leading-20',
    'bg-background-field-base text-foreground-neutral-base',
    'shadow-button-neutral transition-[color,box-shadow] outline-none',
    'hover:bg-background-field-hover cursor-pointer',
    'focus-visible:shadow-border-interactive-with-active',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-background-neutral-disabled disabled:shadow-none disabled:text-foreground-neutral-disabled',
  ],
  {
    variants: {
      variant: {
        base: 'bg-background-field-base',
        component: 'bg-background-field-component',
      },
      size: {
        small: 'h-28 py-4',
        base: 'h-32 py-6',
      },
    },
    defaultVariants: {
      variant: 'base',
      size: 'base',
    },
  },
);

type CommandTriggerProps = ComponentProps<'button'> &
  VariantProps<typeof commandTriggerVariants> & {
    placeholder?: string;
    isLoading?: boolean;
  };

const CommandTrigger = forwardRef<HTMLButtonElement, CommandTriggerProps>(
  ({className, variant, size, placeholder, children, isLoading, ...props}, ref) => {
    const hasValue = Boolean(children);

    return (
      <button
        ref={ref}
        type="button"
        data-slot="command-trigger"
        data-placeholder={!hasValue || undefined}
        className={cn(
          commandTriggerVariants({variant, size}),
          'data-placeholder:text-foreground-neutral-muted',
          className,
        )}
        {...props}
      >
        <span className="flex-1 text-left truncate">{hasValue ? children : placeholder}</span>
        {isLoading ? (
          <Icon name="spinner" className="size-16 text-foreground-neutral-base shrink-0" />
        ) : (
          <Icon
            name="expandUpDownLine"
            className="size-16 text-foreground-neutral-muted shrink-0"
          />
        )}
      </button>
    );
  },
);
CommandTrigger.displayName = 'CommandTrigger';

function Command({className, ...props}: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-10',
        'bg-background-neutral-overlay text-foreground-neutral-base',
        className,
      )}
      {...props}
    />
  );
}

function CommandDialog({children, ...props}: ComponentProps<typeof CommandPrimitive.Dialog>) {
  return (
    <CommandPrimitive.Dialog data-slot="command-dialog" {...props}>
      <div className="fixed inset-0 z-50 bg-background-neutral-overlay/80 backdrop-blur-sm" />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-600 -translate-x-1/2 -translate-y-1/2 p-16">
        <Command className="shadow-tooltip">{children}</Command>
      </div>
    </CommandPrimitive.Dialog>
  );
}

type CommandInputProps = ComponentProps<typeof CommandPrimitive.Input> & {
  showClearButton?: boolean;
  onClear?: () => void;
};

function CommandInput({
  className,
  value,
  onValueChange,
  onClear,
  showClearButton = true,
  ...props
}: CommandInputProps) {
  const [internalValue, setInternalValue] = useState('');
  const isControlled = value !== undefined;
  const inputValue = isControlled ? value : internalValue;
  const hasValue = Boolean(inputValue);

  const handleValueChange = useCallback(
    (newValue: string) => {
      if (!isControlled) {
        setInternalValue(newValue);
      }
      onValueChange?.(newValue);
    },
    [isControlled, onValueChange],
  );

  const handleClear = useCallback(() => {
    if (!isControlled) {
      setInternalValue('');
    }
    onValueChange?.('');
    onClear?.();
  }, [isControlled, onValueChange, onClear]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape' && hasValue) {
        e.preventDefault();
        e.stopPropagation();
        handleClear();
      }
    },
    [hasValue, handleClear],
  );

  return (
    <div className="flex items-center gap-8 border-b border-border-neutral-strong p-8">
      <Icon name="searchLine" className="size-16 shrink-0 text-foreground-neutral-muted" />
      <CommandPrimitive.Input
        data-slot="command-input"
        value={inputValue}
        onValueChange={handleValueChange}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex-1 bg-transparent text-sm leading-20 outline-none',
          'placeholder:text-foreground-neutral-muted',
          'disabled:cursor-not-allowed disabled:text-foreground-neutral-disabled',
          className,
        )}
        {...props}
      />
      {showClearButton && hasValue && (
        <button
          type="button"
          onClick={handleClear}
          className={cn(
            'shrink-0 cursor-pointer rounded-4 p-2',
            'text-foreground-neutral-muted hover:text-foreground-neutral-subtle transition-colors',
          )}
          aria-label="Clear search"
        >
          <Icon name="closeLine" className="size-16" />
        </button>
      )}
    </div>
  );
}

function CommandList({className, ...props}: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn('max-h-300 overflow-y-auto overflow-x-hidden p-4 scrollbar', className)}
      {...props}
    />
  );
}

function CommandEmpty({
  className,
  children,
  ...props
}: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn('py-24 text-center text-sm text-foreground-neutral-muted', className)}
      {...props}
    >
      {children}
    </CommandPrimitive.Empty>
  );
}

function CommandGroup({className, ...props}: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'overflow-hidden',
        '[&_[cmdk-group-heading]]:px-8 [&_[cmdk-group-heading]]:py-4',
        '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:leading-20',
        '[&_[cmdk-group-heading]]:text-foreground-neutral-subtle',
        '[&_[cmdk-group-heading]]:select-none',
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn(
        'relative -mx-4 my-4 h-px',
        'bg-border-neutral-menu-top',
        'after:absolute after:inset-x-0 after:top-px after:h-px',
        'after:bg-border-neutral-menu-bottom',
        className,
      )}
      {...props}
    />
  );
}

function CommandItem({className, ...props}: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-8 rounded-6 px-8 py-6',
        'text-sm leading-20 text-foreground-neutral-subtle outline-none transition-colors',
        'aria-selected:bg-background-components-hover aria-selected:text-foreground-neutral-base',
        'data-[disabled=true]:pointer-events-none data-[disabled=true]:text-foreground-neutral-disabled',
        className,
      )}
      {...props}
    />
  );
}

function CommandShortcut({className, children, ...props}: ComponentProps<typeof Kbd>) {
  return (
    <Kbd data-slot="command-shortcut" className={cn('ml-auto', className)} {...props}>
      {children}
    </Kbd>
  );
}

export type {CommandInputProps, CommandTriggerProps};
export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  CommandTrigger,
  commandTriggerVariants,
};
