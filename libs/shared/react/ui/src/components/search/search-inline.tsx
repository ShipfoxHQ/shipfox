'use client';

import type {VariantProps} from 'class-variance-authority';
import type {ChangeEvent, ComponentProps, KeyboardEvent} from 'react';
import {useCallback, useRef, useState} from 'react';
import {cn} from '#utils/cn.js';
import {Icon} from '../icon/index.js';
import {searchInputVariants} from './search-variants.js';

export type SearchInlineProps = Omit<ComponentProps<'input'>, 'size'> &
  VariantProps<typeof searchInputVariants> & {
    showClearButton?: boolean;
    onClear?: () => void;
  };

export function SearchInline({
  className,
  variant,
  size,
  radius,
  value,
  defaultValue,
  onChange,
  onKeyDown,
  onClear,
  disabled,
  readOnly,
  showClearButton = true,
  'aria-label': ariaLabel,
  ...props
}: SearchInlineProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [internalValue, setInternalValue] = useState<SearchInlineProps['value']>(
    defaultValue ?? '',
  );
  const isControlled = value !== undefined;
  const inputValue = isControlled ? value : internalValue;
  const hasValue = Boolean(inputValue);
  const isSmall = size === 'small';
  const canEdit = !disabled && !readOnly;
  const canShowClearButton = showClearButton && hasValue && canEdit;

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!isControlled) {
        setInternalValue(event.target.value);
      }
      onChange?.(event);
    },
    [isControlled, onChange],
  );

  const handleClear = useCallback(() => {
    if (!isControlled) {
      setInternalValue('');
    }

    if (onChange && inputRef.current) {
      inputRef.current.value = '';
      const syntheticEvent = {
        target: inputRef.current,
        currentTarget: inputRef.current,
      } as ChangeEvent<HTMLInputElement>;
      onChange(syntheticEvent);
    }
    onClear?.();
    inputRef.current?.focus();
  }, [isControlled, onChange, onClear]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape' && hasValue && canEdit) {
        event.preventDefault();
        handleClear();
      }
      onKeyDown?.(event);
    },
    [canEdit, hasValue, handleClear, onKeyDown],
  );

  return (
    <div
      data-slot="search-inline"
      className={cn(searchInputVariants({variant, size, radius}), className)}
    >
      <Icon
        name="searchLine"
        className={cn('shrink-0 text-foreground-neutral-muted', isSmall ? 'size-14' : 'size-16')}
      />
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        disabled={disabled}
        readOnly={readOnly}
        aria-label={ariaLabel ?? 'Search'}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className={cn(
          'min-w-0 flex-1 bg-transparent outline-none',
          'text-base md:text-sm',
          'text-foreground-neutral-base',
          'placeholder:text-foreground-neutral-muted',
          'disabled:cursor-not-allowed disabled:text-foreground-neutral-disabled',
        )}
        {...props}
      />
      {canShowClearButton && (
        <button
          type="button"
          onClick={handleClear}
          className={cn(
            '-mx-2 shrink-0 cursor-pointer rounded-4 p-2',
            'text-foreground-neutral-muted transition-colors hover:text-foreground-neutral-subtle',
          )}
          aria-label="Clear search"
        >
          <Icon name="closeLine" className="size-16" />
        </button>
      )}
    </div>
  );
}
