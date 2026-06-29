'use client';

import type {VariantProps} from 'class-variance-authority';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import {Icon} from '../icon/index.js';
import {Kbd} from '../kbd/index.js';
import {useSearchContext} from './search-context.js';
import {searchTriggerVariants} from './search-variants.js';

const metaShortcutRegex = /^meta\+/i;
const cmdShortcutRegex = /^cmd\+/i;
const ctrlShortcutRegex = /^ctrl\+/i;
const commandGlyphShortcutRegex = /^⌘\+?/i;
const whitespaceRegex = /\s+/;
const lastCharacterRegex = /.$/;

export type SearchTriggerProps = ComponentProps<'button'> &
  VariantProps<typeof searchTriggerVariants> & {
    placeholder?: string;
    shortcut?: string;
  };

export function SearchTrigger({
  className,
  variant,
  size,
  radius,
  placeholder = 'Search',
  shortcut,
  onClick,
  ...props
}: SearchTriggerProps) {
  const {setOpen, shortcutKey} = useSearchContext();
  const isSmall = size === 'small';
  const shortcutLabel = shortcut ?? formatShortcutKey(shortcutKey);

  return (
    <button
      type="button"
      data-slot="search-trigger"
      onClick={(event) => {
        setOpen(true);
        onClick?.(event);
      }}
      className={cn(searchTriggerVariants({variant, size, radius}), className)}
      {...props}
    >
      <Icon name="searchLine" className={cn('shrink-0', isSmall ? 'size-14' : 'size-16')} />
      <span className="flex-1 truncate text-left">{placeholder}</span>
      {shortcutLabel && (
        <Kbd
          aria-hidden="true"
          className={cn(
            isSmall && 'h-16 min-w-16 px-4 text-[10px]',
            radius === 'rounded' && 'rounded-full',
          )}
        >
          {shortcutLabel}
        </Kbd>
      )}
    </button>
  );
}

function formatShortcutKey(shortcutKey: string | undefined) {
  if (!shortcutKey) return undefined;

  return shortcutKey
    .replace(metaShortcutRegex, 'Cmd ')
    .replace(cmdShortcutRegex, 'Cmd ')
    .replace(ctrlShortcutRegex, 'Ctrl ')
    .replace(commandGlyphShortcutRegex, 'Cmd ')
    .replace(whitespaceRegex, ' ')
    .trim()
    .replace(lastCharacterRegex, (key) => key.toUpperCase());
}
