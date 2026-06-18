'use client';

import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import {Avatar} from '../avatar/index.js';

export type UserBadgeProps = ComponentProps<'button'> & {
  name: string;
  avatarSrc?: string;
  avatarFallback?: string;
};

export function UserBadge({className, name, avatarSrc, avatarFallback, ...props}: UserBadgeProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-6 rounded-full px-6 py-2 text-xs font-medium leading-20',
        'bg-background-components-base hover:bg-background-components-hover active:bg-background-components-pressed',
        'text-foreground-neutral-base transition-colors',
        'border border-border-neutral-base-component',
        'h-28',
        className,
      )}
      {...props}
    >
      <Avatar
        className="size-16 shrink-0"
        content="image"
        {...(avatarSrc !== undefined && {src: avatarSrc})}
        {...(avatarFallback !== undefined && {fallback: avatarFallback})}
      />
      <span className="whitespace-nowrap">{name}</span>
    </button>
  );
}
