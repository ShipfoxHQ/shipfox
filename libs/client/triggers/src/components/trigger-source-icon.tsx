import {getIntegrationIcon} from '@shipfox/client-integrations';
import {Icon, type IconName} from '@shipfox/react-ui/icon';
import type {ComponentProps} from 'react';

const SYSTEM_TRIGGER_SOURCE_ICONS: Record<string, IconName> = {
  manual: 'cursorLine',
  cron: 'timeLine',
};

/**
 * Gives first-class icons to system trigger sources; integration sources keep
 * using the integration catalog and its fallback.
 */
export function getTriggerSourceIcon({
  provider,
  source,
}: {
  provider: string | null | undefined;
  source: string | null | undefined;
}): IconName {
  const systemIcon = source ? SYSTEM_TRIGGER_SOURCE_ICONS[source] : undefined;
  return systemIcon ?? getIntegrationIcon(provider);
}

export interface TriggerSourceIconProps extends Omit<ComponentProps<typeof Icon>, 'name'> {
  provider: string | null | undefined;
  source: string | null | undefined;
}

/**
 * Preserves the base icon props so callers can decide whether the glyph is
 * decorative or labeled.
 */
export function TriggerSourceIcon({provider, source, ...props}: TriggerSourceIconProps) {
  return <Icon name={getTriggerSourceIcon({provider, source})} {...props} />;
}
