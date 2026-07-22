import {getIntegrationIcon} from '@shipfox/integration-icons';
import {Icon, type IconName} from '@shipfox/react-ui/icon';
import type {ComponentProps} from 'react';
import type {TriggerEventSource} from '#core/trigger-event.js';

const SYSTEM_TRIGGER_SOURCE_ICONS: Record<string, IconName> = {
  manual: 'cursorLine',
  cron: 'timeLine',
};

/**
 * Stable presentation seam for trigger-source icons. System sources have
 * first-class icons; integration sources delegate to the shared provider
 * catalog so a new provider's icon shows up here without a second edit.
 */
export function getTriggerSourceIcon({
  provider,
  source,
}: {
  provider?: TriggerEventSource['provider'] | undefined;
  source?: TriggerEventSource['source'] | undefined;
}): IconName {
  const systemIcon = source ? SYSTEM_TRIGGER_SOURCE_ICONS[source] : undefined;
  return systemIcon ?? getIntegrationIcon(provider);
}

export interface TriggerSourceIconProps extends Omit<ComponentProps<typeof Icon>, 'name'> {
  provider?: TriggerEventSource['provider'] | undefined;
  source?: TriggerEventSource['source'] | undefined;
}

/**
 * Preserves the base icon props so callers can decide whether the glyph is
 * decorative or labeled.
 */
export function TriggerSourceIcon({provider, source, ...props}: TriggerSourceIconProps) {
  return <Icon name={getTriggerSourceIcon({provider, source})} {...props} />;
}
