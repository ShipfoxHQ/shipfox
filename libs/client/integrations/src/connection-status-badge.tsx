import {Badge} from '@shipfox/react-ui/badge';
import type {IconName} from '@shipfox/react-ui/icon';
import {type ConnectionLifecycleStatus, connectionLifecyclePresentation} from '#core/models.js';

export interface ConnectionStatusBadgeProps {
  status: ConnectionLifecycleStatus;
  className?: string;
}

/**
 * Single source of truth for a connection's lifecycle pill, shared by the
 * integration gallery and any surface that reflects source health. Renders
 * nothing for the expected `active` state.
 */
export function ConnectionStatusBadge({status, className}: ConnectionStatusBadgeProps) {
  const presentation = connectionLifecyclePresentation(status);
  if (presentation.kind === 'active') return null;
  const pill: {variant: 'warning' | 'error'; label: string; iconLeft?: IconName} =
    presentation.kind === 'disabled'
      ? {variant: 'warning', label: presentation.label, iconLeft: 'errorWarningLine'}
      : {variant: 'error', label: presentation.label};
  return (
    <Badge
      variant={pill.variant}
      radius="rounded"
      className={className}
      {...(pill.iconLeft ? {iconLeft: pill.iconLeft} : {})}
    >
      {pill.label}
    </Badge>
  );
}
