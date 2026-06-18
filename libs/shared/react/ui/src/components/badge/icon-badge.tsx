import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import {Icon, type IconName} from '../icon/index.js';

export type IconBadgeVariant = 'neutral' | 'info' | 'feature' | 'success' | 'primary' | 'error';

export type IconBadgeProps = ComponentProps<'span'> & {
  variant?: IconBadgeVariant;
  name?: IconName;
};

const variantStyles: Record<IconBadgeVariant, string> = {
  neutral: 'bg-tag-neutral-bg border-tag-neutral-border',
  info: 'bg-tag-blue-bg border-tag-blue-border',
  feature: 'bg-tag-purple-bg border-tag-purple-border',
  success: 'bg-tag-success-bg border-tag-success-border',
  primary: 'bg-tag-warning-bg border-tag-warning-border',
  error: 'bg-tag-error-bg border-tag-error-border',
};

const iconColorStyles: Record<IconBadgeVariant, string> = {
  neutral: 'text-tag-neutral-icon',
  info: 'text-tag-blue-icon',
  feature: 'text-tag-purple-icon',
  success: 'text-tag-success-icon',
  primary: 'text-tag-warning-icon',
  error: 'text-tag-error-icon',
};

export function IconBadge({className, variant = 'neutral', name, ...props}: IconBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex size-20 items-center justify-center rounded-6 border',
        variantStyles[variant],
        className,
      )}
      {...props}
    >
      {name && <Icon name={name} className={cn('shrink-0', iconColorStyles[variant])} size={12} />}
    </span>
  );
}
