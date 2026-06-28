'use client';

import {Command as CommandPrimitive} from 'cmdk';
import type {ComponentProps, ReactNode} from 'react';
import {useCallback} from 'react';
import {cn} from '#utils/cn.js';
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '../command/index.js';
import {Icon} from '../icon/index.js';
import {Kbd} from '../kbd/index.js';
import {
  Modal,
  ModalBody,
  ModalContent,
  type ModalContentProps,
  ModalTitle,
} from '../modal/index.js';
import {useSearchContext} from './search-context.js';

export type SearchContentProps = {
  breakpoint?: string;
} & Omit<ModalContentProps, 'open' | 'onOpenChange'>;

export function SearchContent({
  breakpoint = '(min-width: 768px)',
  className,
  children,
  overlayClassName,
  onEscapeKeyDown,
  ...props
}: SearchContentProps) {
  const {open, setOpen, searchValue, setSearchValue} = useSearchContext();

  const handleEscapeKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (searchValue) {
        event.preventDefault();
        setSearchValue('');
      } else {
        onEscapeKeyDown?.(event);
      }
    },
    [searchValue, setSearchValue, onEscapeKeyDown],
  );

  return (
    <Modal open={open} onOpenChange={setOpen} breakpoint={breakpoint}>
      <ModalContent
        data-slot="search-content"
        className={cn('md:top-[15%]! md:translate-y-0!', className)}
        overlayClassName={cn('backdrop-blur-sm', overlayClassName)}
        onEscapeKeyDown={handleEscapeKeyDown}
        {...props}
      >
        <ModalTitle className="sr-only">Search</ModalTitle>
        <ModalBody className="flex min-h-0 flex-col overflow-hidden p-0 md:overflow-clip">
          {children}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export type SearchInputProps = Omit<
  ComponentProps<typeof CommandPrimitive.Input>,
  'value' | 'onValueChange'
>;

export function SearchInput({className, ...props}: SearchInputProps) {
  const {open, searchValue, setSearchValue} = useSearchContext();

  return (
    <div className="flex w-full shrink-0 items-center gap-8 border-b border-border-neutral-strong px-16 py-12">
      <Icon name="searchLine" className="size-16 shrink-0 text-foreground-neutral-muted" />
      <CommandPrimitive.Input
        data-slot="search-input"
        autoFocus={open}
        value={searchValue}
        onValueChange={setSearchValue}
        className={cn(
          'flex-1 bg-transparent text-base leading-20 outline-none md:text-sm',
          'placeholder:text-foreground-neutral-muted',
          'disabled:cursor-not-allowed disabled:text-foreground-neutral-disabled',
          className,
        )}
        {...props}
      />
      <Kbd aria-hidden="true">Esc</Kbd>
    </div>
  );
}

export type SearchListProps = ComponentProps<typeof CommandList>;

export function SearchList({className, ...props}: SearchListProps) {
  return (
    <CommandList
      data-slot="search-list"
      className={cn('max-h-none min-h-0 w-full flex-1 px-8 py-4', 'md:max-h-400', className)}
      {...props}
    />
  );
}

export type SearchEmptyProps = ComponentProps<typeof CommandEmpty>;

export function SearchEmpty({className, ...props}: SearchEmptyProps) {
  return (
    <CommandEmpty
      data-slot="search-empty"
      className={cn('py-32 text-center text-sm text-foreground-neutral-muted', className)}
      {...props}
    />
  );
}

export type SearchGroupProps = ComponentProps<typeof CommandGroup>;

export function SearchGroup({className, ...props}: SearchGroupProps) {
  return <CommandGroup data-slot="search-group" className={className} {...props} />;
}

export type SearchItemProps = ComponentProps<typeof CommandItem> & {
  icon?: ReactNode;
  description?: string;
};

export function SearchItem({className, children, icon, description, ...props}: SearchItemProps) {
  return (
    <CommandItem
      data-slot="search-item"
      className={cn('gap-12 rounded-8 p-8', className)}
      {...props}
    >
      {icon && <span className="shrink-0 text-foreground-neutral-muted">{icon}</span>}
      <div className="min-w-0 flex-1">
        <div className="truncate">{children}</div>
        {description && (
          <div className="truncate text-xs text-foreground-neutral-muted">{description}</div>
        )}
      </div>
    </CommandItem>
  );
}

export type SearchSeparatorProps = ComponentProps<typeof CommandSeparator>;

export function SearchSeparator({className, ...props}: SearchSeparatorProps) {
  return (
    <CommandSeparator
      data-slot="search-separator"
      className={cn('mx-0 my-8 bg-border-neutral-base after:hidden', className)}
      {...props}
    />
  );
}

export type SearchFooterProps = ComponentProps<'div'>;

export function SearchFooter({className, ...props}: SearchFooterProps) {
  return (
    <div
      data-slot="search-footer"
      className={cn(
        'flex w-full shrink-0 items-center justify-end gap-12 px-16 py-12',
        'border-t border-border-neutral-strong',
        'bg-background-components-base',
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-8">
        <span className="text-xs font-medium text-foreground-neutral-subtle">Navigation</span>
        <div className="flex items-center gap-4">
          <Kbd aria-hidden="true">Down</Kbd>
          <Kbd aria-hidden="true">Up</Kbd>
        </div>
      </div>
      <div className="h-12 w-px bg-border-neutral-strong" />
      <div className="flex items-center gap-8">
        <span className="text-xs font-medium text-foreground-neutral-subtle">Open result</span>
        <Kbd aria-hidden="true">Enter</Kbd>
      </div>
    </div>
  );
}
