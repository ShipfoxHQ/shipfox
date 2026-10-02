'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import {cva, type VariantProps} from 'class-variance-authority';
import {type ComponentProps, useId} from 'react';
import {cn} from '#utils/cn.js';
import {Icon, type IconName} from '../icon/index.js';

function DropdownMenu({...props}: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      className={cn('outline-none', className)}
      {...props}
    />
  );
}

function DropdownMenuPortal({...props}: ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

const dropdownMenuContentVariants = cva(
  [
    'z-50 min-w-[180px] overflow-hidden rounded-10 p-4',
    'bg-background-neutral-overlay text-foreground-neutral-subtle',
    'shadow-tooltip',
    'data-[state=open]:animate-in data-[state=closed]:animate-out',
    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
    'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
    'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
    'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
  ],
  {
    variants: {
      size: {
        sm: 'min-w-[160px]',
        md: 'min-w-[200px]',
        lg: 'min-w-[240px]',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

type DropdownMenuContentProps = ComponentProps<typeof DropdownMenuPrimitive.Content> &
  VariantProps<typeof dropdownMenuContentVariants> & {
    container?: HTMLElement | null;
  };

function DropdownMenuContent({
  className,
  sideOffset = 4,
  size,
  onCloseAutoFocus,
  container,
  ...props
}: DropdownMenuContentProps) {
  return (
    <DropdownMenuPrimitive.Portal container={container}>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(dropdownMenuContentVariants({size}), className)}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onCloseAutoFocus?.(e);
        }}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuGroup({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group
      data-slot="dropdown-menu-group"
      className={cn('flex flex-col', className)}
      {...props}
    />
  );
}

const dropdownMenuLabelVariants = cva(
  'px-8 py-4 text-xs leading-20 text-foreground-neutral-subtle select-none',
  {
    variants: {
      inset: {
        true: 'pl-32',
      },
    },
  },
);

type DropdownMenuLabelProps = ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean;
};

function DropdownMenuLabel({className, inset, ...props}: DropdownMenuLabelProps) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn(dropdownMenuLabelVariants({inset}), className)}
      {...props}
    />
  );
}

const dropdownMenuItemVariants = cva(
  [
    'relative flex cursor-pointer select-none items-center gap-8 rounded-6 px-8 py-6',
    'text-sm leading-20 text-foreground-neutral-subtle outline-none transition-colors',
    'focus:bg-background-components-hover',
    'data-disabled:pointer-events-none data-disabled:text-foreground-neutral-disabled',
  ],
  {
    variants: {
      inset: {
        true: 'pl-32',
      },
      variant: {
        default: '',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

type DropdownMenuItemProps = ComponentProps<typeof DropdownMenuPrimitive.Item> &
  VariantProps<typeof dropdownMenuItemVariants> & {
    icon?: IconName;
    shortcut?: string;
    closeOnSelect?: boolean;
    iconStyle?: string;
  };

function DropdownMenuItem({
  className,
  inset,
  variant,
  icon,
  shortcut,
  children,
  closeOnSelect = true,
  iconStyle,
  onSelect,
  asChild = false,
  ...props
}: DropdownMenuItemProps) {
  if (asChild) {
    return (
      <DropdownMenuPrimitive.Item
        data-slot="dropdown-menu-item"
        className={cn(dropdownMenuItemVariants({inset, variant}), className)}
        onSelect={(e) => {
          if (!closeOnSelect) e.preventDefault();
          onSelect?.(e);
        }}
        asChild
        {...props}
      >
        {children}
      </DropdownMenuPrimitive.Item>
    );
  }

  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(dropdownMenuItemVariants({inset, variant}), className)}
      onSelect={(e) => {
        if (!closeOnSelect) e.preventDefault();
        onSelect?.(e);
      }}
      {...props}
    >
      {icon && (
        <Icon
          name={icon}
          className={cn('size-16 shrink-0 text-foreground-neutral-subtle', iconStyle)}
        />
      )}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
    </DropdownMenuPrimitive.Item>
  );
}

type DropdownMenuCheckboxItemProps = ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & {
  icon?: IconName;
  shortcut?: string;
  closeOnSelect?: boolean;
};

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  icon,
  shortcut,
  closeOnSelect = true,
  onSelect,
  ...props
}: DropdownMenuCheckboxItemProps) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        [
          'relative flex cursor-pointer select-none items-center gap-8 rounded-6 py-6 pl-32 pr-8',
          'text-sm leading-20 text-foreground-neutral-subtle outline-none transition-colors',
          'focus:bg-background-components-hover',
          'data-disabled:pointer-events-none data-disabled:text-foreground-neutral-disabled',
          'data-[state=checked]:text-foreground-neutral-base',
        ],
        className,
      )}
      checked={checked ?? false}
      onSelect={(e) => {
        if (!closeOnSelect) e.preventDefault();
        onSelect?.(e);
      }}
      {...props}
    >
      <span className="absolute left-8 flex size-16 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Icon name="check" className="size-14 text-foreground-neutral-base" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {icon && <Icon name={icon} className="size-16 shrink-0 text-foreground-neutral-subtle" />}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      className={cn('flex flex-col', className)}
      {...props}
    />
  );
}

type DropdownMenuRadioItemProps = ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  icon?: IconName;
  closeOnSelect?: boolean;
};

function DropdownMenuRadioItem({
  className,
  children,
  icon,
  closeOnSelect = true,
  onSelect,
  ...props
}: DropdownMenuRadioItemProps) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        [
          'relative flex cursor-pointer select-none items-center gap-8 rounded-6 py-6 pl-32 pr-8',
          'text-sm leading-20 text-foreground-neutral-subtle outline-none transition-colors',
          'focus:bg-background-components-hover',
          'data-disabled:pointer-events-none data-disabled:text-foreground-neutral-disabled',
          'data-[state=checked]:text-foreground-neutral-base',
        ],
        className,
      )}
      onSelect={(e) => {
        if (!closeOnSelect) e.preventDefault();
        onSelect?.(e);
      }}
      {...props}
    >
      <span className="absolute left-8 flex size-16 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Icon name="ellipseMiniSolid" className="size-6 text-foreground-neutral-base" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {icon && <Icon name={icon} className="size-16 shrink-0 text-foreground-neutral-subtle" />}
      <span className="flex-1 truncate">{children}</span>
    </DropdownMenuPrimitive.RadioItem>
  );
}

type DropdownMenuSegmentedRadioGroupProps = ComponentProps<
  typeof DropdownMenuPrimitive.RadioGroup
> & {
  label: string;
};

/**
 * A labelled row with a compact icon segmented control. The segments stay menu
 * radio items rather than a standalone radio group because the menu swallows
 * Tab, so only menu items are reachable from the keyboard.
 */
function DropdownMenuSegmentedRadioGroup({
  label,
  className,
  ...props
}: DropdownMenuSegmentedRadioGroupProps) {
  const labelId = useId();

  return (
    <div
      data-slot="dropdown-menu-segmented-radio-group"
      className={cn('flex items-center justify-between gap-8 px-8 py-4', className)}
    >
      <span id={labelId} className="select-none text-sm leading-20 text-foreground-neutral-subtle">
        {label}
      </span>
      <DropdownMenuPrimitive.RadioGroup
        aria-labelledby={labelId}
        className="flex items-center gap-2 rounded-8 bg-background-switch-off p-2"
        {...props}
      />
    </div>
  );
}

type DropdownMenuSegmentedRadioItemProps = Omit<
  ComponentProps<typeof DropdownMenuPrimitive.RadioItem>,
  'children'
> & {
  icon: IconName;
  label: string;
};

function DropdownMenuSegmentedRadioItem({
  className,
  icon,
  label,
  onSelect,
  ...props
}: DropdownMenuSegmentedRadioItemProps) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-segmented-radio-item"
      aria-label={label}
      textValue={label}
      className={cn(
        [
          'flex h-20 w-28 cursor-pointer select-none items-center justify-center rounded-6',
          'text-foreground-neutral-muted outline-none transition-[background-color,color,box-shadow]',
          'data-[state=unchecked]:data-highlighted:bg-background-button-transparent-hover data-highlighted:text-foreground-neutral-base',
          'data-disabled:pointer-events-none data-disabled:text-foreground-neutral-disabled',
          'data-[state=checked]:bg-background-button-neutral-default data-[state=checked]:text-foreground-neutral-base data-[state=checked]:shadow-button-neutral',
          // The checked thumb's elevation shadow must not hide the focus ring.
          'focus-visible:shadow-focus-inset data-[state=checked]:focus-visible:shadow-focus-inset',
        ],
        className,
      )}
      // Keep the menu open so the change is visible in place.
      onSelect={(e) => {
        e.preventDefault();
        onSelect?.(e);
      }}
      {...props}
    >
      <Icon name={icon} className="size-14" />
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
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

type DropdownMenuShortcutProps = ComponentProps<'span'>;

function DropdownMenuShortcut({className, ...props}: DropdownMenuShortcutProps) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        'ml-auto text-xs leading-20 text-foreground-neutral-muted tabular-nums',
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSub({...props}: ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

type DropdownMenuSubTriggerProps = ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean;
  icon?: IconName;
};

function DropdownMenuSubTrigger({
  className,
  inset,
  icon,
  children,
  ...props
}: DropdownMenuSubTriggerProps) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(
        [
          'relative flex cursor-pointer select-none items-center gap-8 rounded-6 px-8 py-6',
          'text-sm leading-20 text-foreground-neutral-subtle outline-none transition-colors',
          'focus:bg-background-components-hover',
          'data-[state=open]:bg-background-components-hover',
          'data-disabled:pointer-events-none data-disabled:text-foreground-neutral-disabled',
          'data-[state=checked]:text-foreground-neutral-base',
        ],
        inset && 'pl-32',
        className,
      )}
      {...props}
    >
      {icon && <Icon name={icon} className="size-16 shrink-0 text-foreground-neutral-subtle" />}
      <span className="flex-1 truncate">{children}</span>
      <Icon name="chevronRight" className="ml-auto size-14 text-foreground-neutral-muted" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        [
          'z-50 min-w-180 overflow-hidden rounded-10 p-4',
          'bg-background-neutral-overlay text-foreground-neutral-subtle',
          'shadow-tooltip',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        ],
        className,
      )}
      {...props}
    />
  );
}

export type {
  DropdownMenuCheckboxItemProps,
  DropdownMenuContentProps,
  DropdownMenuItemProps,
  DropdownMenuLabelProps,
  DropdownMenuRadioItemProps,
  DropdownMenuSegmentedRadioGroupProps,
  DropdownMenuSegmentedRadioItemProps,
  DropdownMenuShortcutProps,
  DropdownMenuSubTriggerProps,
};
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSegmentedRadioGroup,
  DropdownMenuSegmentedRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  dropdownMenuContentVariants,
  dropdownMenuItemVariants,
  dropdownMenuLabelVariants,
};
