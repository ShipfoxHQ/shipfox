import {cva, type VariantProps} from 'class-variance-authority';
import type {ComponentProps} from 'react';
import {Icon, type IconName} from '#components/icon/index.js';
import {cn} from '#utils/cn.js';

const calloutTypes = ['default', 'info', 'success', 'warning', 'error'] as const;
type CalloutType = (typeof calloutTypes)[number];

const defaultIconByType = {
  default: null,
  info: 'info',
  success: 'checkboxCircleFill',
  warning: 'errorWarningFill',
  error: 'closeCircleFill',
} as const satisfies Record<CalloutType, IconName | null>;

const calloutIconClassByType = {
  default: 'text-tag-neutral-icon',
  info: 'text-tag-blue-icon',
  success: 'text-tag-success-icon',
  warning: 'text-tag-warning-icon',
  error: 'text-tag-error-icon',
} as const satisfies Record<CalloutType, string>;

const calloutAccessibleLabelByType = {
  default: null,
  info: 'Info',
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
} as const satisfies Record<CalloutType, string | null>;

const calloutBaseVariants = cva('w-full text-sm flex gap-12 items-start', {
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

const calloutLineVariants = cva('w-4 self-stretch my-4 rounded-full', {
  variants: {
    type: {
      default: 'bg-tag-neutral-icon',
      info: 'bg-tag-blue-icon',
      success: 'bg-tag-success-icon',
      warning: 'bg-tag-warning-icon',
      error: 'bg-tag-error-icon',
    },
  },
  defaultVariants: {
    type: 'default',
  },
});

type CalloutProps = ComponentProps<'div'> &
  VariantProps<typeof calloutBaseVariants> & {
    type?: CalloutType;
    /**
     * `undefined` uses the default status glyph, `null` keeps the colored side-line.
     * Callers that need live announcement should opt in with `role` or `aria-live`.
     */
    icon?: IconName | null | undefined;
  };

function Callout({className, variant, type = 'default', icon, children, ...props}: CalloutProps) {
  const resolvedIcon = icon === undefined ? defaultIconByType[type] : icon;
  const accessibleLabel = calloutAccessibleLabelByType[type];

  return (
    <div data-slot="callout" className={cn(calloutBaseVariants({variant}), className)} {...props}>
      {accessibleLabel ? <span className="sr-only">{accessibleLabel}: </span> : null}
      {resolvedIcon ? (
        <Icon
          data-slot="callout-icon"
          name={resolvedIcon}
          size={20}
          className={cn('mt-2 flex-shrink-0', calloutIconClassByType[type])}
          aria-hidden="true"
        />
      ) : (
        <div
          data-slot="callout-line"
          className={cn(calloutLineVariants({type}))}
          aria-hidden="true"
        />
      )}
      {children}
    </div>
  );
}

function CalloutContent({className, ...props}: ComponentProps<'div'>) {
  return <div data-slot="callout-content" className={cn('flex-1 min-w-0', className)} {...props} />;
}

function CalloutTitle({className, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="callout-title"
      className={cn('font-medium text-sm leading-20 text-foreground-neutral-base mb-4', className)}
      {...props}
    />
  );
}

function CalloutDescription({className, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="callout-description"
      className={cn(
        'text-xs leading-20 text-foreground-neutral-muted [&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  );
}

function CalloutActions({className, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="callout-actions"
      className={cn('flex items-center gap-8 shrink-0', className)}
      {...props}
    />
  );
}

const calloutActionVariants = cva(
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

function CalloutAction({
  className,
  variant,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof calloutActionVariants>) {
  return (
    <button
      data-slot="callout-action"
      type="button"
      className={cn(calloutActionVariants({variant}), className)}
      {...props}
    />
  );
}

export {
  Callout,
  CalloutAction,
  CalloutActions,
  CalloutContent,
  CalloutDescription,
  CalloutTitle,
  type CalloutType,
  calloutTypes,
};
