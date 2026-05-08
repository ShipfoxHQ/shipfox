import {cva, type VariantProps} from 'class-variance-authority';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';

const inlineTipsBaseVariants = cva('w-full text-sm flex gap-12 items-center', {
  variants: {
    variant: {
      primary:
        'bg-background-components-base text-foreground-neutral-base border border-border-neutral-base shadow-button-neutral rounded-8 px-12 py-8',
      secondary: 'bg-transparent text-foreground-neutral-base',
    },
  },
  defaultVariants: {
    variant: 'primary',
  },
});

const inlineTipsLineVariants = cva('w-4 self-stretch my-4 rounded-full', {
  variants: {
    type: {
      default: 'bg-tag-neutral-icon',
      info: 'bg-tag-blue-icon',
      success: 'bg-tag-success-icon',
      error: 'bg-tag-error-icon',
    },
  },
  defaultVariants: {
    type: 'default',
  },
});

type InlineTipsProps = ComponentProps<'div'> &
  VariantProps<typeof inlineTipsBaseVariants> & {
    type?: 'default' | 'info' | 'success' | 'error';
  };

function InlineTips({className, variant, type = 'default', children, ...props}: InlineTipsProps) {
  return (
    <div
      data-slot="inline-tips"
      className={cn(inlineTipsBaseVariants({variant}), className)}
      {...props}
    >
      <div
        data-slot="inline-tips-line"
        className={cn(inlineTipsLineVariants({type}))}
        aria-hidden="true"
      />
      {children}
    </div>
  );
}

function InlineTipsContent({className, ...props}: ComponentProps<'div'>) {
  return (
    <div data-slot="inline-tips-content" className={cn('flex-1 min-w-0', className)} {...props} />
  );
}

function InlineTipsTitle({className, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="inline-tips-title"
      className={cn('font-medium text-sm leading-20 text-foreground-neutral-base mb-4', className)}
      {...props}
    />
  );
}

function InlineTipsDescription({className, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="inline-tips-description"
      className={cn(
        'text-xs leading-20 text-foreground-neutral-muted [&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  );
}

function InlineTipsActions({className, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="inline-tips-actions"
      className={cn('flex items-center gap-8 shrink-0', className)}
      {...props}
    />
  );
}

const inlineTipsActionVariants = cva(
  'rounded-6 px-10 py-6 text-xs font-medium leading-20 transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-background-accent-blue-base focus-visible:ring-offset-2',
  {
    variants: {
      variant: {
        primary:
          'bg-background-button-inverted-default text-foreground-contrast-primary shadow-button-inverted hover:bg-background-button-inverted-hover active:bg-background-button-inverted-pressed focus-visible:shadow-button-inverted-focus disabled:bg-background-neutral-disabled disabled:text-foreground-neutral-disabled disabled:shadow-none',
        secondary:
          'bg-background-button-neutral-default text-foreground-neutral-base shadow-button-neutral hover:bg-background-button-neutral-hover active:bg-background-button-neutral-pressed disabled:bg-background-neutral-disabled focus-visible:shadow-button-neutral-focus disabled:text-foreground-neutral-disabled disabled:shadow-none',
      },
    },
    defaultVariants: {
      variant: 'primary',
    },
  },
);

function InlineTipsAction({
  className,
  variant,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof inlineTipsActionVariants>) {
  return (
    <button
      data-slot="inline-tips-action"
      type="button"
      className={cn(inlineTipsActionVariants({variant}), className)}
      {...props}
    />
  );
}

export {
  InlineTips,
  InlineTipsAction,
  InlineTipsActions,
  InlineTipsContent,
  InlineTipsDescription,
  InlineTipsTitle,
};
