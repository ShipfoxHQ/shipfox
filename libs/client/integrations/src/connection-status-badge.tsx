import type {IntegrationConnectionLifecycleStatusDto} from '@shipfox/api-integration-core-dto';
import {Badge} from '@shipfox/react-ui/badge';
import type {IconName} from '@shipfox/react-ui/icon';

const lifecyclePills: Record<
  IntegrationConnectionLifecycleStatusDto,
  {variant: 'warning' | 'error'; label: string; iconLeft?: IconName} | undefined
> = {
  // `active` is the expected state and carries no badge.
  active: undefined,
  disabled: {variant: 'warning', label: 'Disabled', iconLeft: 'errorWarningLine'},
  error: {variant: 'error', label: 'Error'},
};

export interface ConnectionStatusBadgeProps {
  status: IntegrationConnectionLifecycleStatusDto;
  className?: string;
}

/**
 * Single source of truth for a connection's lifecycle pill, shared by the
 * integration gallery and any surface that reflects source health. Renders
 * nothing for the expected `active` state.
 */
export function ConnectionStatusBadge({status, className}: ConnectionStatusBadgeProps) {
  const pill = lifecyclePills[status];
  if (!pill) return null;
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
